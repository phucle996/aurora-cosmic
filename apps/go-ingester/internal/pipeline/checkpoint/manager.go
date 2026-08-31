package checkpoint

import (
	"context"
	"sync"
	"time"

	"go-ingester/internal/model"
	"go-ingester/internal/pipeline/plan"
	"go-ingester/internal/pipeline/storage"
)

// Manager provides thread-safe access and persistence for an active ingestion Checkpoint.
type Manager struct {
	mu     sync.RWMutex
	cp     *model.Checkpoint
	prevCp *model.Checkpoint // previous run's checkpoint, used for cross-run resume
	store  *Store
}

func (m *Manager) EnsureProduct(product model.ManifestProduct) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if _, exists := m.cp.Products[product.SourceProductID]; exists {
		return
	}
	objectKey, _ := storage.ObjectKeyFor(product)
	sampleID := ""
	if product.TICID > 0 && product.Sector > 0 {
		sampleID = plan.SampleID(product.TICID, product.Sector)
	}
	now := time.Now().UTC()
	m.cp.Products[product.SourceProductID] = &model.ProductCheckpoint{SourceProductID: product.SourceProductID, SampleID: sampleID, ProductKind: product.Kind, SourceURI: product.DataURI, ObjectKey: objectKey, ExpectedSizeBytes: product.SizeBytes, State: model.StatePlanned, Sector: product.Sector, TICID: product.TICID, Camera: product.Camera, CCD: product.CCD, UpdatedAt: now}
	m.cp.UpdatedAt = now
}

func (m *Manager) UpdateProductDetector(productID string, camera, ccd int) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if product, ok := m.cp.Products[productID]; ok {
		product.Camera, product.CCD, product.UpdatedAt = camera, ccd, time.Now().UTC()
		m.cp.UpdatedAt = product.UpdatedAt
	}
}

// NewManager creates or wraps a Checkpoint Manager.
func NewManager(store *Store, cp *model.Checkpoint) *Manager {
	return &Manager{
		cp:    cp,
		store: store,
	}
}

// SetPreviousCheckpoint attaches the previous run's checkpoint for cross-run resume.
func (m *Manager) SetPreviousCheckpoint(prev *model.Checkpoint) {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.prevCp = prev
}

// PreviousCheckpoint returns the previous run's checkpoint (read-only). Returns nil
// if no previous checkpoint was loaded or the manager was not configured for resume.
func (m *Manager) PreviousCheckpoint() *model.Checkpoint {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.prevCp
}

// GetProductCheckpoint returns a thread-safe copy of a product's checkpoint state.
func (m *Manager) GetProductCheckpoint(productID string) (model.ProductCheckpoint, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	pc, ok := m.cp.Products[productID]
	if !ok {
		return model.ProductCheckpoint{}, false
	}
	return *pc, true
}

// UpdateProductState updates a product's state, attempt count, size, sha256, and last error.
func (m *Manager) UpdateProductState(productID string, state model.ProductState, size int64, sha256 string, lastErr error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	pc, ok := m.cp.Products[productID]
	if !ok {
		return
	}

	pc.State = state
	if state == model.StateDownloading {
		pc.Attempts++
	}
	if size > 0 {
		pc.SizeBytes = size
	}
	if sha256 != "" {
		pc.SHA256 = sha256
	}
	if lastErr != nil {
		pc.LastError = lastErr.Error()
	} else if state == model.StateStored || state == model.StatePublished {
		pc.LastError = ""
	}
	pc.UpdatedAt = time.Now().UTC()
	m.cp.UpdatedAt = pc.UpdatedAt
}

// FinalizeRun updates overall run status based on product final states.
func (m *Manager) FinalizeRun() model.RunStatus {
	m.mu.Lock()
	defer m.mu.Unlock()

	hasFailures := false
	allDone := true

	for _, pc := range m.cp.Products {
		if pc.State == model.StateFailed {
			hasFailures = true
		} else if pc.State != model.StatePublished && pc.State != model.StateStored {
			allDone = false
		}
	}

	if allDone && !hasFailures {
		m.cp.Status = model.RunStatusCompleted
	} else if hasFailures {
		m.cp.Status = model.RunStatusCompletedWithFailures
	} else {
		m.cp.Status = model.RunStatusRunning
	}

	return m.cp.Status
}

// Flush persists the current Checkpoint state to MinIO storage.
func (m *Manager) Flush(ctx context.Context) error {
	m.mu.Lock()
	defer m.mu.Unlock()

	if m.store == nil {
		return nil
	}
	return m.store.Save(ctx, m.cp)
}

// GetCheckpoint returns an immutable snapshot of the active checkpoint. The
// manager never exposes its internal map/pointers to callers, preventing a
// read-only status endpoint or test from racing with worker updates.
func (m *Manager) GetCheckpoint() model.Checkpoint {
	m.mu.RLock()
	defer m.mu.RUnlock()

	if m.cp == nil {
		return model.Checkpoint{}
	}
	cp := *m.cp
	cp.Products = make(map[string]*model.ProductCheckpoint, len(m.cp.Products))
	for id, product := range m.cp.Products {
		if product == nil {
			cp.Products[id] = nil
			continue
		}
		productCopy := *product
		cp.Products[id] = &productCopy
	}
	return cp
}
