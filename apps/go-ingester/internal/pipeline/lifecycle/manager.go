// Package lifecycle implements the Bronze rolling-window eviction lifecycle for
// the AURORA Go Ingester.
//
// # Ownership
//
//	Go Ingester  — owns Bronze storage lifecycle, writes lifecycle checkpoints
//	Rust Preprocessor — reads lifecycle checkpoints, never deletes Bronze
//
// # Data Flow
//
//	Bronze usage >= HIGH watermark
//	  |
//	  v
//	discover EVICTABLE candidates from lineage/v1/
//	  |
//	  v
//	sort: oldest stored_at ASC, tie-break: bronze_object_key ASC
//	  |
//	  v
//	for each candidate:
//	    revalidate Silver still exists
//	    revalidate lineage still matches
//	    revalidate source_uri present
//	    write lifecycle checkpoint EVICTING
//	    DeleteObject Bronze
//	    verify Bronze absent
//	    write lifecycle checkpoint RAW_DELETED
//	    subtract from running usage
//	    stop when usage <= LOW
//	  |
//	  v
//	return EvictionResult
package lifecycle

import (
	"context"
	"fmt"
	"log/slog"
	"sort"
	"strings"
	"time"
)

// ────────────────────────────────────────────────────────────────────────────
// Constants
// ────────────────────────────────────────────────────────────────────────────

const (
	// PolicyVersion is the eviction policy identifier frozen for V1.
	PolicyVersion = "bronze-eviction-v1"

	// SchemaVersion is the lifecycle checkpoint schema version.
	SchemaVersion = 1

	// MinIO object key prefix for lineage records.
	lineagePrefix = "lineage/v1/"

	// MinIO object key prefix for lifecycle checkpoints.
	lifecyclePrefix = "checkpoints/lifecycle/objects/"
)

// ────────────────────────────────────────────────────────────────────────────
// State Machine
// ────────────────────────────────────────────────────────────────────────────

// LifecycleState models the Bronze eviction lifecycle for a single product.
type LifecycleState string

const (
	StateEvictable      LifecycleState = "EVICTABLE"
	StateEvicting       LifecycleState = "EVICTING"
	StateRawDeleted     LifecycleState = "RAW_DELETED"
	StateEvictionFailed LifecycleState = "EVICTION_FAILED"
)

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle Checkpoint
// ────────────────────────────────────────────────────────────────────────────

// LifecycleRecord is the durable lifecycle checkpoint stored in MinIO.
//
// Stored at: checkpoints/lifecycle/objects/<lineage_id>.json
type LifecycleRecord struct {
	SchemaVersion   uint32         `json:"schema_version"`
	LineageID       string         `json:"lineage_id"`
	SourceProductID string         `json:"source_product_id"`
	BronzeBucket    string         `json:"bronze_bucket"`
	BronzeObjectKey string         `json:"bronze_object_key"`
	BronzeSHA256    string         `json:"bronze_sha256"`
	BronzeSizeBytes int64          `json:"bronze_size_bytes"`
	PolicyVersion   string         `json:"policy_version"`
	State           LifecycleState `json:"state"`
	Attempts        uint32         `json:"attempts"`
	LastError       string         `json:"last_error,omitempty"`

	EvictionStartedAt *time.Time `json:"eviction_started_at,omitempty"`
	DeletedAt         *time.Time `json:"deleted_at,omitempty"`

	UpdatedAt time.Time `json:"updated_at"`
}

// ────────────────────────────────────────────────────────────────────────────
// Lineage Record (Go-side read-only)
// ────────────────────────────────────────────────────────────────────────────

// lineageEviction is the eviction sub-record from the lineage JSON.
type lineageEviction struct {
	PolicyVersion string `json:"policy_version"`
	Eligible      bool   `json:"eligible"`
	Reason        string `json:"reason"`
}

// lineageBronze captures the Bronze identity fields from a lineage record.
type lineageBronze struct {
	Bucket    string `json:"bucket"`
	ObjectKey string `json:"object_key"`
	SizeBytes int64  `json:"size_bytes"`
	SHA256    string `json:"sha256"`
}

// lineageSilver captures the Silver identity fields from a lineage record.
type lineageSilver struct {
	Bucket           string `json:"bucket"`
	ObjectKey        string `json:"object_key"`
	SizeBytes        int64  `json:"size_bytes"`
	SHA256           string `json:"sha256"`
	SchemaVersion    string `json:"schema_version"`
	ProcessorVersion string `json:"processor_version"`
}

// lineageSource captures source provenance fields.
type lineageSource struct {
	SourceProductID string  `json:"source_product_id"`
	SourceURI       *string `json:"source_uri"`
}

// lineageRecord is the minimal subset of a lineage-v1 JSON record needed for lifecycle decisions.
type lineageRecord struct {
	SchemaVersion uint32          `json:"schema_version"`
	LineageID     string          `json:"lineage_id"`
	Status        string          `json:"status"`
	CommittedAt   string          `json:"committed_at"`
	Source        lineageSource   `json:"source"`
	Bronze        lineageBronze   `json:"bronze"`
	Silver        lineageSilver   `json:"silver"`
	Eviction      lineageEviction `json:"eviction"`
}

// ────────────────────────────────────────────────────────────────────────────
// Candidate
// ────────────────────────────────────────────────────────────────────────────

// Candidate is a Bronze object proposed for eviction.
type Candidate struct {
	LineageID              string
	SourceProductID        string
	BronzeBucket           string
	BronzeObjectKey        string
	BronzeSizeBytes        int64
	BronzeSHA256           string
	SilverBucket           string
	SilverObjectKey        string
	SilverSHA256           string
	SilverSchemaVersion    string
	SilverProcessorVersion string
	SourceURI              string
	// StoredAt is the Bronze storage timestamp used for oldest-first ordering.
	StoredAt time.Time
}

// ────────────────────────────────────────────────────────────────────────────
// Result
// ────────────────────────────────────────────────────────────────────────────

// BlockedReason explains why a candidate was skipped.
type BlockedReason struct {
	LineageID       string
	BronzeObjectKey string
	Reason          string
}

// EvictionResult describes the outcome of a cleanup run.
type EvictionResult struct {
	UsageBefore    int64
	UsageAfter     int64
	ObjectsDeleted int
	BytesDeleted   int64
	Blocked        []BlockedReason
	TargetReached  bool // true when UsageAfter <= LowWatermarkBytes
	DryRun         bool
}

// ────────────────────────────────────────────────────────────────────────────
// StorageClient interface (only the subset needed by lifecycle)
// ────────────────────────────────────────────────────────────────────────────

// StorageClient defines the MinIO operations required by the lifecycle manager.
type StorageClient interface {
	ListBronzeUsage(ctx context.Context, bucket string) (int64, int, error)
	ListLineageKeys(ctx context.Context, bucket, prefix string) ([]string, error)
	GetJSONObject(ctx context.Context, bucket, objectKey string, dst any) (bool, error)
	PutJSONObject(ctx context.Context, bucket, objectKey string, src any) error
	StatObject(ctx context.Context, bucket, objectKey string) (interface{ GetSize() int64 }, bool, error)
	DeleteObject(ctx context.Context, bucket, objectKey string) error
}

// ────────────────────────────────────────────────────────────────────────────
// Manager
// ────────────────────────────────────────────────────────────────────────────

// Policy holds the storage watermark configuration.
type Policy struct {
	MaxBytes           int64
	HighWatermarkBytes int64
	LowWatermarkBytes  int64
}

// Validate ensures LOW < HIGH < MAX and all values are positive.
func (p Policy) Validate() error {
	if p.MaxBytes <= 0 {
		return fmt.Errorf("MaxBytes must be > 0")
	}
	if p.LowWatermarkBytes <= 0 {
		return fmt.Errorf("LowWatermarkBytes must be > 0")
	}
	if p.LowWatermarkBytes >= p.HighWatermarkBytes {
		return fmt.Errorf("LowWatermarkBytes (%d) must be < HighWatermarkBytes (%d)", p.LowWatermarkBytes, p.HighWatermarkBytes)
	}
	if p.HighWatermarkBytes >= p.MaxBytes {
		return fmt.Errorf("HighWatermarkBytes (%d) must be < MaxBytes (%d)", p.HighWatermarkBytes, p.MaxBytes)
	}
	return nil
}

// minioObjectStatAdapter adapts *storage.MinIOClient for lifecycle stat.
// We use a raw interface to avoid import cycles; the concrete type is injected via Manager.
type rawStorageClient interface {
	ListBronzeUsage(ctx context.Context, bucket string) (int64, int, error)
	ListLineageKeys(ctx context.Context, bucket, prefix string) ([]string, error)
	GetJSONObject(ctx context.Context, bucket, objectKey string, dst any) (bool, error)
	PutJSONObject(ctx context.Context, bucket, objectKey string, src any) error
	DeleteObject(ctx context.Context, bucket, objectKey string) error
	// StatObjectExists checks if an object exists — returns (sizeBytes, exists, error)
	StatObjectExists(ctx context.Context, bucket, objectKey string) (int64, bool, error)
}

// Manager orchestrates Bronze lifecycle cleanup.
type Manager struct {
	storage rawStorageClient
	bucket  string
	policy  Policy
	log     *slog.Logger
}

// NewManager creates a lifecycle Manager.
func NewManager(storage rawStorageClient, bucket string, policy Policy, log *slog.Logger) (*Manager, error) {
	if err := policy.Validate(); err != nil {
		return nil, fmt.Errorf("invalid lifecycle policy: %w", err)
	}
	return &Manager{
		storage: storage,
		bucket:  bucket,
		policy:  policy,
		log:     log,
	}, nil
}

// ────────────────────────────────────────────────────────────────────────────
// RunCleanup — main entry point
// ────────────────────────────────────────────────────────────────────────────

// RunCleanup evaluates Bronze storage pressure and evicts eligible objects until
// usage drops below the low watermark, or no safe candidates remain.
//
// When dryRun is true no DeleteObject calls are made.
func (m *Manager) RunCleanup(ctx context.Context, dryRun bool) (*EvictionResult, error) {
	// Measure current Bronze usage from actual MinIO objects.
	usageBefore, _, err := m.storage.ListBronzeUsage(ctx, m.bucket)
	if err != nil {
		return nil, fmt.Errorf("measure bronze usage: %w", err)
	}

	m.log.Info("bronze_cleanup start",
		slog.String("operation", "bronze_cleanup"),
		slog.Int64("usage_bytes", usageBefore),
		slog.Int64("high_bytes", m.policy.HighWatermarkBytes),
		slog.Int64("low_bytes", m.policy.LowWatermarkBytes),
		slog.Int64("max_bytes", m.policy.MaxBytes),
		slog.Bool("dry_run", dryRun),
	)

	result := &EvictionResult{
		UsageBefore: usageBefore,
		UsageAfter:  usageBefore,
		DryRun:      dryRun,
	}

	// Hysteresis: do nothing below HIGH watermark.
	if usageBefore < m.policy.HighWatermarkBytes {
		result.TargetReached = true
		return result, nil
	}

	// Discover and sort candidates.
	candidates, err := m.discoverCandidates(ctx)
	if err != nil {
		return nil, fmt.Errorf("discover eviction candidates: %w", err)
	}

	// Sort: oldest stored_at ASC, tie-break: bronze_object_key ASC.
	sort.Slice(candidates, func(i, j int) bool {
		if candidates[i].StoredAt.Equal(candidates[j].StoredAt) {
			return candidates[i].BronzeObjectKey < candidates[j].BronzeObjectKey
		}
		return candidates[i].StoredAt.Before(candidates[j].StoredAt)
	})

	currentUsage := usageBefore

	for _, candidate := range candidates {
		if currentUsage <= m.policy.LowWatermarkBytes {
			break
		}

		m.log.Info("eviction_candidate",
			slog.String("operation", "eviction_candidate"),
			slog.String("lineage_id", candidate.LineageID),
			slog.String("source_product_id", candidate.SourceProductID),
			slog.String("bronze_object_key", candidate.BronzeObjectKey),
			slog.Int64("size_bytes", candidate.BronzeSizeBytes),
			slog.Time("stored_at", candidate.StoredAt),
		)

		// Pre-delete revalidation.
		blocked, reason := m.revalidate(ctx, &candidate)
		if blocked {
			m.log.Warn("eviction_blocked",
				slog.String("operation", "eviction_blocked"),
				slog.String("lineage_id", candidate.LineageID),
				slog.String("reason", reason),
			)
			result.Blocked = append(result.Blocked, BlockedReason{
				LineageID:       candidate.LineageID,
				BronzeObjectKey: candidate.BronzeObjectKey,
				Reason:          reason,
			})
			continue
		}

		if dryRun {
			result.ObjectsDeleted++
			result.BytesDeleted += candidate.BronzeSizeBytes
			currentUsage -= candidate.BronzeSizeBytes
			continue
		}

		// Execute deletion with lifecycle checkpoint transitions.
		if err := m.evict(ctx, &candidate); err != nil {
			m.log.Error("eviction failed",
				slog.String("lineage_id", candidate.LineageID),
				slog.String("bronze_object_key", candidate.BronzeObjectKey),
				slog.Any("error", err),
			)
			result.Blocked = append(result.Blocked, BlockedReason{
				LineageID:       candidate.LineageID,
				BronzeObjectKey: candidate.BronzeObjectKey,
				Reason:          fmt.Sprintf("EVICTION_FAILED: %v", err),
			})
			continue
		}

		result.ObjectsDeleted++
		result.BytesDeleted += candidate.BronzeSizeBytes
		currentUsage -= candidate.BronzeSizeBytes

		m.log.Info("bronze_evicted",
			slog.String("operation", "bronze_evicted"),
			slog.String("lineage_id", candidate.LineageID),
			slog.String("object_key", candidate.BronzeObjectKey),
			slog.Int64("deleted_bytes", candidate.BronzeSizeBytes),
			slog.Int64("usage_after", currentUsage),
		)
	}

	result.UsageAfter = currentUsage
	result.TargetReached = currentUsage <= m.policy.LowWatermarkBytes

	if !result.TargetReached {
		m.log.Warn("storage_pressure",
			slog.String("operation", "storage_pressure"),
			slog.Int64("usage_bytes", currentUsage),
			slog.Int64("target_bytes", m.policy.LowWatermarkBytes),
			slog.String("status", "INSUFFICIENT_EVICTABLE_CAPACITY"),
		)
	}

	return result, nil
}

// ────────────────────────────────────────────────────────────────────────────
// CheckProjectedCapacity — preflight before ingestion
// ────────────────────────────────────────────────────────────────────────────

// CheckProjectedCapacity verifies that adding a product of expectedBytes will
// not exceed the MAX watermark. If projected usage >= HIGH, cleanup is attempted.
// Returns an error if ingestion should be blocked.
func (m *Manager) CheckProjectedCapacity(ctx context.Context, expectedBytes int64) error {
	if expectedBytes > m.policy.MaxBytes {
		return fmt.Errorf("product size %d exceeds AURORA_BRONZE_MAX_BYTES %d — rejected by V1 storage policy",
			expectedBytes, m.policy.MaxBytes)
	}

	currentUsage, _, err := m.storage.ListBronzeUsage(ctx, m.bucket)
	if err != nil {
		return fmt.Errorf("measure bronze usage for preflight: %w", err)
	}

	projected := currentUsage + expectedBytes
	if projected <= m.policy.HighWatermarkBytes {
		return nil // Sufficient capacity — proceed.
	}

	// Projected usage >= HIGH: attempt cleanup first.
	m.log.Info("preflight cleanup triggered",
		slog.Int64("current_usage", currentUsage),
		slog.Int64("expected_bytes", expectedBytes),
		slog.Int64("projected", projected),
		slog.Int64("high_bytes", m.policy.HighWatermarkBytes),
	)

	result, cleanupErr := m.RunCleanup(ctx, false)
	if cleanupErr != nil {
		return fmt.Errorf("preflight cleanup failed: %w", cleanupErr)
	}

	// Re-check after cleanup.
	if result.UsageAfter+expectedBytes > m.policy.MaxBytes {
		return fmt.Errorf(
			"BRONZE_STORAGE_PRESSURE: projected usage %d exceeds MAX %d — even after cleanup (%d freed). Ingestion blocked",
			result.UsageAfter+expectedBytes, m.policy.MaxBytes, result.BytesDeleted,
		)
	}

	return nil
}

// ────────────────────────────────────────────────────────────────────────────
// discoverCandidates — read lineage records and filter EVICTABLE
// ────────────────────────────────────────────────────────────────────────────

func (m *Manager) discoverCandidates(ctx context.Context) ([]Candidate, error) {
	keys, err := m.storage.ListLineageKeys(ctx, m.bucket, lineagePrefix)
	if err != nil {
		return nil, fmt.Errorf("list lineage keys: %w", err)
	}

	var candidates []Candidate
	for _, key := range keys {
		var rec lineageRecord
		found, err := m.storage.GetJSONObject(ctx, m.bucket, key, &rec)
		if err != nil || !found {
			continue
		}

		// Only consider LINEAGE_COMMITTED records with eligible=true.
		if rec.Status != "LINEAGE_COMMITTED" || !rec.Eviction.Eligible {
			continue
		}

		// Check existing lifecycle record — skip already deleted.
		lifecycleKey := lifecycleCheckpointKey(rec.LineageID)
		var lc LifecycleRecord
		found, err = m.storage.GetJSONObject(ctx, m.bucket, lifecycleKey, &lc)
		if err == nil && found && lc.State == StateRawDeleted {
			continue // Already evicted.
		}
		// Also skip if currently evicting — will be handled on next recovery run.
		if err == nil && found && lc.State == StateEvicting {
			continue
		}

		sourceURI := ""
		if rec.Source.SourceURI != nil {
			sourceURI = *rec.Source.SourceURI
		}

		// Parse committed_at as a fallback for stored_at ordering.
		storedAt, parseErr := time.Parse(time.RFC3339, rec.CommittedAt)
		if parseErr != nil {
			storedAt = time.Time{}
		}

		candidates = append(candidates, Candidate{
			LineageID:              rec.LineageID,
			SourceProductID:        rec.Source.SourceProductID,
			BronzeBucket:           rec.Bronze.Bucket,
			BronzeObjectKey:        rec.Bronze.ObjectKey,
			BronzeSizeBytes:        rec.Bronze.SizeBytes,
			BronzeSHA256:           rec.Bronze.SHA256,
			SilverBucket:           rec.Silver.Bucket,
			SilverObjectKey:        rec.Silver.ObjectKey,
			SilverSHA256:           rec.Silver.SHA256,
			SilverSchemaVersion:    rec.Silver.SchemaVersion,
			SilverProcessorVersion: rec.Silver.ProcessorVersion,
			SourceURI:              sourceURI,
			StoredAt:               storedAt,
		})
	}

	return candidates, nil
}

// ────────────────────────────────────────────────────────────────────────────
// revalidate — pre-delete safety check
// ────────────────────────────────────────────────────────────────────────────

// revalidate returns (blocked=true, reason) if the candidate is not safe to delete.
func (m *Manager) revalidate(ctx context.Context, c *Candidate) (blocked bool, reason string) {
	// 1. Source URI must be present in lineage.
	if c.SourceURI == "" {
		return true, "SOURCE_URI_MISSING"
	}

	// 2. Bronze must currently exist.
	_, bronzeExists, err := m.storage.StatObjectExists(ctx, c.BronzeBucket, c.BronzeObjectKey)
	if err != nil {
		return true, fmt.Sprintf("BRONZE_STAT_ERROR: %v", err)
	}
	if !bronzeExists {
		// Bronze already gone — check if we have a lifecycle record.
		lifecycleKey := lifecycleCheckpointKey(c.LineageID)
		var lc LifecycleRecord
		found, _ := m.storage.GetJSONObject(ctx, m.bucket, lifecycleKey, &lc)
		if found && lc.State == StateRawDeleted {
			return true, "ALREADY_DELETED"
		}
		return true, "UNEXPECTED_BRONZE_MISSING"
	}

	// 3. Silver must currently exist.
	_, silverExists, err := m.storage.StatObjectExists(ctx, c.SilverBucket, c.SilverObjectKey)
	if err != nil {
		return true, fmt.Sprintf("SILVER_STAT_ERROR: %v", err)
	}
	if !silverExists {
		return true, "SILVER_MISSING"
	}

	// 4. Silver lineage must still match (processor version + schema version).
	if c.SilverSHA256 == "" {
		return true, "SILVER_SHA256_MISSING"
	}

	return false, ""
}

// ────────────────────────────────────────────────────────────────────────────
// evict — safe deletion with lifecycle checkpoint transitions
// ────────────────────────────────────────────────────────────────────────────

func (m *Manager) evict(ctx context.Context, c *Candidate) error {
	lifecycleKey := lifecycleCheckpointKey(c.LineageID)

	// Load or create lifecycle record.
	var lc LifecycleRecord
	found, err := m.storage.GetJSONObject(ctx, m.bucket, lifecycleKey, &lc)
	if err != nil {
		return fmt.Errorf("load lifecycle checkpoint: %w", err)
	}

	now := time.Now().UTC()

	if !found {
		lc = LifecycleRecord{
			SchemaVersion:   SchemaVersion,
			LineageID:       c.LineageID,
			SourceProductID: c.SourceProductID,
			BronzeBucket:    c.BronzeBucket,
			BronzeObjectKey: c.BronzeObjectKey,
			BronzeSHA256:    c.BronzeSHA256,
			BronzeSizeBytes: c.BronzeSizeBytes,
			PolicyVersion:   PolicyVersion,
			State:           StateEvictable,
			Attempts:        0,
			UpdatedAt:       now,
		}
	}

	// Handle EVICTING crash-recovery: Bronze already deleted.
	if lc.State == StateEvicting {
		_, bronzeExists, statErr := m.storage.StatObjectExists(ctx, c.BronzeBucket, c.BronzeObjectKey)
		if statErr == nil && !bronzeExists {
			// Crash-after-delete recovery: mark RAW_DELETED.
			lc.State = StateRawDeleted
			lc.DeletedAt = &now
			lc.UpdatedAt = now
			_ = m.storage.PutJSONObject(ctx, m.bucket, lifecycleKey, &lc)
			return nil
		}
		// Bronze still exists — revalidate and continue deletion below.
	}

	// Transition: EVICTABLE → EVICTING (persisted before DeleteObject).
	lc.Attempts++
	lc.State = StateEvicting
	lc.EvictionStartedAt = &now
	lc.UpdatedAt = now
	if err := m.storage.PutJSONObject(ctx, m.bucket, lifecycleKey, &lc); err != nil {
		return fmt.Errorf("persist EVICTING checkpoint: %w", err)
	}

	// DeleteObject.
	if err := m.storage.DeleteObject(ctx, c.BronzeBucket, c.BronzeObjectKey); err != nil {
		lc.State = StateEvictionFailed
		lc.LastError = err.Error()
		lc.UpdatedAt = time.Now().UTC()
		_ = m.storage.PutJSONObject(ctx, m.bucket, lifecycleKey, &lc)
		return fmt.Errorf("delete bronze object: %w", err)
	}

	// Verify Bronze absent.
	_, stillExists, statErr := m.storage.StatObjectExists(ctx, c.BronzeBucket, c.BronzeObjectKey)
	if statErr != nil || stillExists {
		lc.State = StateEvictionFailed
		lc.LastError = "Bronze object still exists after DeleteObject — stat may be stale"
		lc.UpdatedAt = time.Now().UTC()
		_ = m.storage.PutJSONObject(ctx, m.bucket, lifecycleKey, &lc)
		return fmt.Errorf("bronze object still present after deletion")
	}

	// Transition: EVICTING → RAW_DELETED.
	deletedAt := time.Now().UTC()
	lc.State = StateRawDeleted
	lc.DeletedAt = &deletedAt
	lc.UpdatedAt = deletedAt
	if err := m.storage.PutJSONObject(ctx, m.bucket, lifecycleKey, &lc); err != nil {
		// Checkpoint write failed AFTER successful deletion.
		// Log the critical inconsistency — Bronze is gone but we couldn't record it.
		m.log.Error("CRITICAL: RAW_DELETED checkpoint write failed after successful Bronze deletion",
			slog.String("lineage_id", c.LineageID),
			slog.String("bronze_object_key", c.BronzeObjectKey),
			slog.Any("error", err),
		)
		// Return nil to prevent false eviction_failed reporting — Bronze IS deleted.
		return nil
	}

	return nil
}

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

// lifecycleCheckpointKey builds the MinIO key for a lifecycle record.
func lifecycleCheckpointKey(lineageID string) string {
	return lifecyclePrefix + lineageID + ".json"
}

// IsRawDeleted checks if a lineage ID has a RAW_DELETED lifecycle record.
// Rust may call equivalent logic to distinguish intentional eviction from unexpected missing Bronze.
func IsRawDeleted(ctx context.Context, storage rawStorageClient, bucket, lineageID string) (bool, error) {
	key := lifecycleCheckpointKey(lineageID)
	var lc LifecycleRecord
	found, err := storage.GetJSONObject(ctx, bucket, key, &lc)
	if err != nil {
		return false, err
	}
	if !found {
		return false, nil
	}
	return lc.State == StateRawDeleted, nil
}

// LifecycleCheckpointKey returns the MinIO object key for a lifecycle record.
// Exported for use by cmd_cleanup and tests.
func LifecycleCheckpointKey(lineageID string) string {
	return lifecycleCheckpointKey(lineageID)
}

// BuildLineagePrefix returns the lineage MinIO prefix.
func BuildLineagePrefix() string { return lineagePrefix }

// FormatBytes formats a byte count as a human-readable GiB string.
func FormatBytes(b int64) string {
	gib := float64(b) / (1024 * 1024 * 1024)
	return fmt.Sprintf("%.2f GiB (%d bytes)", gib, b)
}

// StoragePressureError is returned when safe cleanup cannot free enough capacity.
type StoragePressureError struct {
	UsageBytes     int64
	TargetBytes    int64
	EvictableBytes int64
}

func (e *StoragePressureError) Error() string {
	return fmt.Sprintf("BRONZE_STORAGE_PRESSURE: usage=%s target=%s evictable=%s",
		FormatBytes(e.UsageBytes),
		FormatBytes(e.TargetBytes),
		FormatBytes(e.EvictableBytes),
	)
}

// ────────────────────────────────────────────────────────────────────────────
// minioAdapter — adapts *storage.MinIOClient to rawStorageClient
// ────────────────────────────────────────────────────────────────────────────

// MinIOAdapter wraps the concrete MinIOClient to satisfy rawStorageClient.
// This avoids import cycles between lifecycle and storage packages.
type MinIOAdapter struct {
	ListBronzeUsageFn  func(ctx context.Context, bucket string) (int64, int, error)
	ListLineageKeysFn  func(ctx context.Context, bucket, prefix string) ([]string, error)
	GetJSONObjectFn    func(ctx context.Context, bucket, objectKey string, dst any) (bool, error)
	PutJSONObjectFn    func(ctx context.Context, bucket, objectKey string, src any) error
	DeleteObjectFn     func(ctx context.Context, bucket, objectKey string) error
	StatObjectExistsFn func(ctx context.Context, bucket, objectKey string) (int64, bool, error)
}

func (a *MinIOAdapter) ListBronzeUsage(ctx context.Context, bucket string) (int64, int, error) {
	return a.ListBronzeUsageFn(ctx, bucket)
}
func (a *MinIOAdapter) ListLineageKeys(ctx context.Context, bucket, prefix string) ([]string, error) {
	return a.ListLineageKeysFn(ctx, bucket, prefix)
}
func (a *MinIOAdapter) GetJSONObject(ctx context.Context, bucket, key string, dst any) (bool, error) {
	return a.GetJSONObjectFn(ctx, bucket, key, dst)
}
func (a *MinIOAdapter) PutJSONObject(ctx context.Context, bucket, key string, src any) error {
	return a.PutJSONObjectFn(ctx, bucket, key, src)
}
func (a *MinIOAdapter) DeleteObject(ctx context.Context, bucket, key string) error {
	return a.DeleteObjectFn(ctx, bucket, key)
}
func (a *MinIOAdapter) StatObjectExists(ctx context.Context, bucket, key string) (int64, bool, error) {
	return a.StatObjectExistsFn(ctx, bucket, key)
}

// StatObjectExists adds a size-returning stat variant to MinIOClient for the adapter.
func StatObjectExists(ctx context.Context, client interface {
	StatObject(ctx context.Context, bucket, objectKey string) (interface{ GetSize() int64 }, bool, error)
}, bucket, objectKey string) (int64, bool, error) {
	// Resolved via adapter — not called directly.
	return 0, false, fmt.Errorf("not implemented directly")
}

// ────────────────────────────────────────────────────────────────────────────
// RecoveryCheck — Rust-facing concept implemented in Go for lifecycle awareness
// ────────────────────────────────────────────────────────────────────────────

// LifecycleStateFor returns the current lifecycle state for a lineage ID, if any.
// Returns ("", false, nil) if no lifecycle record exists.
func LifecycleStateFor(ctx context.Context, storage rawStorageClient, bucket, lineageID string) (LifecycleState, bool, error) {
	key := lifecycleCheckpointKey(lineageID)
	var lc LifecycleRecord
	found, err := storage.GetJSONObject(ctx, bucket, key, &lc)
	if err != nil {
		return "", false, err
	}
	if !found {
		return "", false, nil
	}
	return lc.State, true, nil
}

// IgnoreLineageSuffix strips the .json suffix from a lineage key for display.
func IgnoreLineageSuffix(key string) string {
	return strings.TrimSuffix(key, ".json")
}
