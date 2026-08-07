package checkpoint

import (
	"context"
	"sync"
	"time"

	"go-ingester/internal/manifest"
	"go-ingester/internal/storage"
)

// Manager provides thread-safe access and persistence for an active ingestion Checkpoint.
type Manager struct {
	mu     sync.RWMutex
	cp     *Checkpoint
	store  *Store
	bucket string
}

// NewManager creates or wraps a Checkpoint Manager.
func NewManager(store *Store, cp *Checkpoint) *Manager {
	return &Manager{
		cp:    cp,
		store: store,
	}
}

// CreateNewInitialCheckpoint initializes a fresh Checkpoint for a manifest.
func CreateNewInitialCheckpoint(runID string, manifestPath string, manifestHash string, products []manifest.ManifestProduct) *Checkpoint {
	prodMap := make(map[string]*ProductCheckpoint, len(products))
	now := time.Now().UTC()

	for _, p := range products {
		key, _ := storage.BuildObjectKey(p)
		sampleID := ""
		if p.TICID > 0 && p.Sector > 0 {
			sampleID = manifest.SampleID(p.TICID, p.Sector)
		}

		prodMap[p.SourceProductID] = &ProductCheckpoint{
			SourceProductID:   p.SourceProductID,
			SampleID:          sampleID,
			ProductKind:       p.Kind,
			SourceURI:         p.DataURI,
			ObjectKey:         key,
			ExpectedSizeBytes: p.SizeBytes,
			State:             StatePlanned,
			Attempts:          0,
			Sector:            p.Sector,
			TICID:             p.TICID,
			Camera:            p.Camera,
			CCD:               p.CCD,
			UpdatedAt:         now,
		}
	}

	return &Checkpoint{
		SchemaVersion: SchemaVersion,
		RunID:         runID,
		Status:        RunStatusRunning,
		ManifestPath:  manifestPath,
		ManifestHash:  manifestHash,
		StartedAt:     now,
		UpdatedAt:     now,
		Products:      prodMap,
	}
}

// GetProductCheckpoint returns a thread-safe copy of a product's checkpoint state.
func (m *Manager) GetProductCheckpoint(productID string) (ProductCheckpoint, bool) {
	m.mu.RLock()
	defer m.mu.RUnlock()

	pc, ok := m.cp.Products[productID]
	if !ok {
		return ProductCheckpoint{}, false
	}
	return *pc, true
}

// UpdateProductState updates a product's state, attempt count, size, sha256, and last error.
func (m *Manager) UpdateProductState(productID string, state ProductState, size int64, sha256 string, lastErr error) {
	m.mu.Lock()
	defer m.mu.Unlock()

	pc, ok := m.cp.Products[productID]
	if !ok {
		return
	}

	pc.State = state
	if state == StateDownloading {
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
	} else if state == StateStored || state == StatePublished {
		pc.LastError = ""
	}
	pc.UpdatedAt = time.Now().UTC()
	m.cp.UpdatedAt = pc.UpdatedAt
}

// FinalizeRun updates overall run status based on product final states.
func (m *Manager) FinalizeRun() RunStatus {
	m.mu.Lock()
	defer m.mu.Unlock()

	hasFailures := false
	allDone := true

	for _, pc := range m.cp.Products {
		if pc.State == StateFailed {
			hasFailures = true
		} else if pc.State != StatePublished && pc.State != StateStored {
			allDone = false
		}
	}

	if allDone && !hasFailures {
		m.cp.Status = RunStatusCompleted
	} else if hasFailures {
		m.cp.Status = RunStatusCompletedWithFailures
	} else {
		m.cp.Status = RunStatusRunning
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

// GetCheckpoint returns the underlying Checkpoint pointer.
func (m *Manager) GetCheckpoint() *Checkpoint {
	m.mu.RLock()
	defer m.mu.RUnlock()
	return m.cp
}
