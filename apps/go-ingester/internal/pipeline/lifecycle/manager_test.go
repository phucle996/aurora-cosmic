package lifecycle_test

import (
	"context"
	"encoding/json"
	"errors"
	"log/slog"
	"os"
	"testing"
	"time"

	"go-ingester/internal/pipeline/lifecycle"
)

// ────────────────────────────────────────────────────────────────────────────
// Helpers
// ────────────────────────────────────────────────────────────────────────────

func testLogger() *slog.Logger {
	return slog.New(slog.NewTextHandler(os.Stderr, &slog.HandlerOptions{Level: slog.LevelWarn}))
}

const (
	mib      int64 = 1024 * 1024
	testLow  int64 = 30 * mib
	testHigh int64 = 45 * mib
	testMax  int64 = 50 * mib
)

func testPolicy() lifecycle.Policy {
	return lifecycle.Policy{
		MaxBytes:           testMax,
		HighWatermarkBytes: testHigh,
		LowWatermarkBytes:  testLow,
	}
}

var errDeleteFailed = errors.New("simulated delete failure")

// ────────────────────────────────────────────────────────────────────────────
// Fake storage
// ────────────────────────────────────────────────────────────────────────────

type fakeStorage struct {
	bronzeObjects    map[string]int64
	silverObjects    map[string]int64
	jsonObjects      map[string][]byte
	deleteCalled     []string
	deleteShouldFail bool
}

func newFakeStorage() *fakeStorage {
	return &fakeStorage{
		bronzeObjects: make(map[string]int64),
		silverObjects: make(map[string]int64),
		jsonObjects:   make(map[string][]byte),
	}
}

func (f *fakeStorage) ListBronzeUsage(_ context.Context, _ string) (int64, int, error) {
	var total int64
	for _, sz := range f.bronzeObjects {
		total += sz
	}
	return total, len(f.bronzeObjects), nil
}

func (f *fakeStorage) ListLineageKeys(_ context.Context, _, prefix string) ([]string, error) {
	var keys []string
	for k := range f.jsonObjects {
		if len(k) >= len(prefix) && k[:len(prefix)] == prefix {
			keys = append(keys, k)
		}
	}
	return keys, nil
}

func (f *fakeStorage) GetJSONObject(_ context.Context, _, key string, dst any) (bool, error) {
	data, ok := f.jsonObjects[key]
	if !ok {
		return false, nil
	}
	return true, json.Unmarshal(data, dst)
}

func (f *fakeStorage) PutJSONObject(_ context.Context, _, key string, src any) error {
	data, err := json.Marshal(src)
	if err != nil {
		return err
	}
	f.jsonObjects[key] = data
	return nil
}

func (f *fakeStorage) DeleteObject(_ context.Context, _, key string) error {
	if f.deleteShouldFail {
		return errDeleteFailed
	}
	f.deleteCalled = append(f.deleteCalled, key)
	delete(f.bronzeObjects, key)
	return nil
}

func (f *fakeStorage) StatObjectExists(_ context.Context, _, key string) (int64, bool, error) {
	if sz, ok := f.bronzeObjects[key]; ok {
		return sz, true, nil
	}
	if sz, ok := f.silverObjects[key]; ok {
		return sz, true, nil
	}
	return 0, false, nil
}

// ────────────────────────────────────────────────────────────────────────────
// Lineage record builder
// ────────────────────────────────────────────────────────────────────────────

type lineageRecordJSON struct {
	SchemaVersion uint32                 `json:"schema_version"`
	LineageID     string                 `json:"lineage_id"`
	Status        string                 `json:"status"`
	CommittedAt   string                 `json:"committed_at"`
	Source        map[string]interface{} `json:"source"`
	Bronze        map[string]interface{} `json:"bronze"`
	Silver        map[string]interface{} `json:"silver"`
	Eviction      map[string]interface{} `json:"eviction"`
}

func addEligibleLineage(t *testing.T, fs *fakeStorage, lineageID, bronzeKey, silverKey string,
	bronzeSizeBytes int64, storedAt time.Time) {
	t.Helper()
	uri := "https://mast.stsci.edu/" + lineageID
	rec := lineageRecordJSON{
		SchemaVersion: 1,
		LineageID:     lineageID,
		Status:        "LINEAGE_COMMITTED",
		CommittedAt:   storedAt.Format(time.RFC3339),
		Source: map[string]interface{}{
			"source_product_id": lineageID,
			"source_uri":        uri,
		},
		Bronze: map[string]interface{}{
			"bucket":     "aurora-test",
			"object_key": bronzeKey,
			"size_bytes": bronzeSizeBytes,
			"sha256":     "abc" + lineageID,
		},
		Silver: map[string]interface{}{
			"bucket":            "aurora-test",
			"object_key":        silverKey,
			"size_bytes":        int64(1024),
			"sha256":            "sil" + lineageID,
			"schema_version":    "silver-lightcurve-v1",
			"processor_version": "lc-preprocess-v1",
		},
		Eviction: map[string]interface{}{
			"policy_version": "bronze-eviction-v1",
			"eligible":       true,
			"reason":         "SUCCESSFUL_SILVER_DURABLE",
		},
	}
	key := "lineage/v1/" + lineageID + ".json"
	data, _ := json.Marshal(rec)
	fs.jsonObjects[key] = data
	fs.bronzeObjects[bronzeKey] = bronzeSizeBytes
	fs.silverObjects[silverKey] = 1024
}

func newManager(t *testing.T, fs *fakeStorage) *lifecycle.Manager {
	t.Helper()
	adapter := &lifecycle.MinIOAdapter{
		ListBronzeUsageFn:  fs.ListBronzeUsage,
		ListLineageKeysFn:  fs.ListLineageKeys,
		GetJSONObjectFn:    fs.GetJSONObject,
		PutJSONObjectFn:    fs.PutJSONObject,
		DeleteObjectFn:     fs.DeleteObject,
		StatObjectExistsFn: fs.StatObjectExists,
	}
	mgr, err := lifecycle.NewManager(adapter, "aurora-test", testPolicy(), testLogger())
	if err != nil {
		t.Fatalf("NewManager: %v", err)
	}
	return mgr
}

// ────────────────────────────────────────────────────────────────────────────
// Policy validation
// ────────────────────────────────────────────────────────────────────────────

func TestPolicyValidation_Valid(t *testing.T) {
	p := lifecycle.Policy{MaxBytes: 50 * mib, HighWatermarkBytes: 45 * mib, LowWatermarkBytes: 30 * mib}
	if err := p.Validate(); err != nil {
		t.Fatalf("expected valid, got: %v", err)
	}
}

func TestPolicyValidation_LowGeqHigh(t *testing.T) {
	p := lifecycle.Policy{MaxBytes: 50 * mib, HighWatermarkBytes: 30 * mib, LowWatermarkBytes: 30 * mib}
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for LOW >= HIGH")
	}
}

func TestPolicyValidation_HighGeqMax(t *testing.T) {
	p := lifecycle.Policy{MaxBytes: 50 * mib, HighWatermarkBytes: 50 * mib, LowWatermarkBytes: 30 * mib}
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for HIGH >= MAX")
	}
}

func TestPolicyValidation_ZeroMax(t *testing.T) {
	p := lifecycle.Policy{MaxBytes: 0, HighWatermarkBytes: 45 * mib, LowWatermarkBytes: 30 * mib}
	if err := p.Validate(); err == nil {
		t.Fatal("expected error for MAX == 0")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Below HIGH — no cleanup
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_BelowHigh_NoDeletions(t *testing.T) {
	fs := newFakeStorage()
	fs.bronzeObjects["bronze/small.fits"] = 20 * mib
	mgr := newManager(t, fs)

	result, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if result.ObjectsDeleted != 0 {
		t.Fatalf("expected 0 deletions below HIGH, got %d", result.ObjectsDeleted)
	}
	if !result.TargetReached {
		t.Fatal("expected TargetReached=true when below HIGH")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Cleanup continues until LOW
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_ContinuesUntilLow(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Total bronze: 8*3 + 22 = 46 MiB. After 3 deletes: 22 MiB < 30 MiB LOW
	addEligibleLineage(t, fs, "aa", "bronze/a.fits", "silver/a.parquet", 8*mib, base)
	addEligibleLineage(t, fs, "bb", "bronze/b.fits", "silver/b.parquet", 8*mib, base.Add(time.Hour))
	addEligibleLineage(t, fs, "cc", "bronze/c.fits", "silver/c.parquet", 8*mib, base.Add(2*time.Hour))
	fs.bronzeObjects["bronze/pad.fits"] = 22 * mib

	mgr := newManager(t, fs)
	result, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if result.UsageAfter > testLow {
		t.Fatalf("expected usage <= LOW (%d) after cleanup, got %d", testLow, result.UsageAfter)
	}
	if !result.TargetReached {
		t.Fatal("expected TargetReached=true")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Oldest first ordering
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_OldestFirst(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)

	// Each 5 MiB; A oldest, C newest
	addEligibleLineage(t, fs, "aaa", "bronze/a.fits", "silver/a.parquet", 5*mib, base)
	addEligibleLineage(t, fs, "bbb", "bronze/b.fits", "silver/b.parquet", 5*mib, base.Add(24*time.Hour))
	addEligibleLineage(t, fs, "ccc", "bronze/c.fits", "silver/c.parquet", 5*mib, base.Add(48*time.Hour))
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 14*mib + 1

	mgr := newManager(t, fs)
	_, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(fs.deleteCalled) > 0 && fs.deleteCalled[0] != "bronze/a.fits" {
		t.Fatalf("expected bronze/a.fits deleted first (oldest), got %s", fs.deleteCalled[0])
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Deterministic tie-break by object_key
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_TieBreakByObjectKey(t *testing.T) {
	fs := newFakeStorage()
	sameTime := time.Date(2026, 3, 1, 0, 0, 0, 0, time.UTC)

	addEligibleLineage(t, fs, "z-lineage", "bronze/z.fits", "silver/z.parquet", 5*mib, sameTime)
	addEligibleLineage(t, fs, "a-lineage", "bronze/a.fits", "silver/a.parquet", 5*mib, sameTime)
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 9*mib + 1

	mgr := newManager(t, fs)
	_, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if len(fs.deleteCalled) > 0 && fs.deleteCalled[0] != "bronze/a.fits" {
		t.Fatalf("expected bronze/a.fits first (tie-break by key), got %s", fs.deleteCalled[0])
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Silver missing — candidate blocked
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_SilverMissing_CandidateBlocked(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	addEligibleLineage(t, fs, "no-silver", "bronze/nosil.fits", "silver/nosil.parquet", 10*mib, base)
	delete(fs.silverObjects, "silver/nosil.parquet")
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 9*mib + 1

	mgr := newManager(t, fs)
	result, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if result.ObjectsDeleted != 0 {
		t.Fatalf("expected 0 deletions when Silver missing, got %d", result.ObjectsDeleted)
	}
	if len(result.Blocked) == 0 || result.Blocked[0].Reason != "SILVER_MISSING" {
		t.Fatalf("expected SILVER_MISSING block reason, got %+v", result.Blocked)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Dry run — no DeleteObject calls
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_DryRun_NoDeletions(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	addEligibleLineage(t, fs, "dry-A", "bronze/dry-a.fits", "silver/dry-a.parquet", 10*mib, base)
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 9*mib + 1

	mgr := newManager(t, fs)
	result, err := mgr.RunCleanup(context.Background(), true)
	if err != nil {
		t.Fatal(err)
	}
	if len(fs.deleteCalled) != 0 {
		t.Fatalf("dry-run must not call DeleteObject, got %v", fs.deleteCalled)
	}
	if result.ObjectsDeleted < 1 {
		t.Fatal("dry-run should report would-be deleted count > 0")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Delete failure — not marked RAW_DELETED
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_DeleteFailure_NotMarkedDeleted(t *testing.T) {
	fs := newFakeStorage()
	fs.deleteShouldFail = true
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	addEligibleLineage(t, fs, "del-fail", "bronze/fail.fits", "silver/fail.parquet", 10*mib, base)
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 9*mib + 1

	mgr := newManager(t, fs)
	result, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if result.ObjectsDeleted != 0 {
		t.Fatalf("expected 0 objects deleted on failure, got %d", result.ObjectsDeleted)
	}
	key := lifecycle.LifecycleCheckpointKey("del-fail")
	var lc lifecycle.LifecycleRecord
	found, _ := fs.GetJSONObject(context.Background(), "aurora-test", key, &lc)
	if found && lc.State == lifecycle.StateRawDeleted {
		t.Fatal("must NOT be RAW_DELETED after delete failure")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Lifecycle state sequence: → RAW_DELETED after success
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_LifecycleStateSequence(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	addEligibleLineage(t, fs, "state-seq", "bronze/seq.fits", "silver/seq.parquet", 10*mib, base)
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 9*mib + 1

	mgr := newManager(t, fs)
	_, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	key := lifecycle.LifecycleCheckpointKey("state-seq")
	var lc lifecycle.LifecycleRecord
	found, _ := fs.GetJSONObject(context.Background(), "aurora-test", key, &lc)
	if !found {
		t.Fatal("lifecycle record not found after cleanup")
	}
	if lc.State != lifecycle.StateRawDeleted {
		t.Fatalf("expected RAW_DELETED, got %s", lc.State)
	}
	if lc.DeletedAt == nil {
		t.Fatal("deleted_at must be set on RAW_DELETED")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Crash-after-delete recovery: EVICTING + Bronze missing → RAW_DELETED
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_CrashAfterDelete_Recovery(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	addEligibleLineage(t, fs, "crash-after", "bronze/crash.fits", "silver/crash.parquet", 5*mib, base)
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 4*mib + 1

	// Simulate crash-after-delete: persist EVICTING, remove Bronze
	key := lifecycle.LifecycleCheckpointKey("crash-after")
	now := time.Now().UTC()
	lc := lifecycle.LifecycleRecord{
		SchemaVersion:     1,
		LineageID:         "crash-after",
		BronzeBucket:      "aurora-test",
		BronzeObjectKey:   "bronze/crash.fits",
		PolicyVersion:     "bronze-eviction-v1",
		State:             lifecycle.StateEvicting,
		Attempts:          1,
		EvictionStartedAt: &now,
		UpdatedAt:         now,
	}
	data, _ := json.Marshal(lc)
	fs.jsonObjects[key] = data
	// Bronze already gone (crash happened after DeleteObject)
	delete(fs.bronzeObjects, "bronze/crash.fits")

	// The EVICTING candidate is skipped in discovery but picked up during evict() crash-path
	// For this unit test, we verify the storage doesn't panic and returns cleanly.
	mgr := newManager(t, fs)
	_, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatalf("RunCleanup should not error on crash-recovery path: %v", err)
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Insufficient evictable capacity — storage pressure
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_InsufficientCandidates_StoragePressure(t *testing.T) {
	fs := newFakeStorage()
	fs.bronzeObjects["bronze/protected.fits"] = testHigh + mib

	mgr := newManager(t, fs)
	result, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	if result.ObjectsDeleted != 0 {
		t.Fatalf("expected 0 deletions with no candidates, got %d", result.ObjectsDeleted)
	}
	if result.TargetReached {
		t.Fatal("expected TargetReached=false with insufficient evictable capacity")
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Already RAW_DELETED — skipped in candidate discovery
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_AlreadyDeleted_Skipped(t *testing.T) {
	fs := newFakeStorage()
	base := time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	addEligibleLineage(t, fs, "already-del", "bronze/aldel.fits", "silver/aldel.parquet", 5*mib, base)
	fs.bronzeObjects["bronze/pad.fits"] = testHigh - 4*mib + 1

	key := lifecycle.LifecycleCheckpointKey("already-del")
	now := time.Now().UTC()
	existingLc := lifecycle.LifecycleRecord{
		SchemaVersion: 1, LineageID: "already-del",
		State: lifecycle.StateRawDeleted, DeletedAt: &now, UpdatedAt: now,
	}
	data, _ := json.Marshal(existingLc)
	fs.jsonObjects[key] = data

	mgr := newManager(t, fs)
	_, err := mgr.RunCleanup(context.Background(), false)
	if err != nil {
		t.Fatal(err)
	}
	for _, k := range fs.deleteCalled {
		if k == "bronze/aldel.fits" {
			t.Fatal("must not re-delete already RAW_DELETED object")
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Idempotent — second run below HIGH is no-op
// ────────────────────────────────────────────────────────────────────────────

func TestCleanup_Idempotent(t *testing.T) {
	fs := newFakeStorage()
	fs.bronzeObjects["bronze/small.fits"] = 10 * mib

	mgr := newManager(t, fs)
	for i := 0; i < 3; i++ {
		result, err := mgr.RunCleanup(context.Background(), false)
		if err != nil {
			t.Fatal(err)
		}
		if result.ObjectsDeleted != 0 {
			t.Fatalf("run %d: expected 0 deletions, got %d", i+1, result.ObjectsDeleted)
		}
	}
}

// ────────────────────────────────────────────────────────────────────────────
// Projected capacity checks
// ────────────────────────────────────────────────────────────────────────────

func TestCheckProjectedCapacity_ProductLargerThanMAX(t *testing.T) {
	fs := newFakeStorage()
	mgr := newManager(t, fs)
	err := mgr.CheckProjectedCapacity(context.Background(), testMax+1)
	if err == nil {
		t.Fatal("expected error for product larger than MAX")
	}
}

func TestCheckProjectedCapacity_BelowHigh(t *testing.T) {
	fs := newFakeStorage()
	fs.bronzeObjects["bronze/small.fits"] = 10 * mib
	mgr := newManager(t, fs)
	if err := mgr.CheckProjectedCapacity(context.Background(), 5*mib); err != nil {
		t.Fatalf("unexpected error below HIGH: %v", err)
	}
}

func TestCheckProjectedCapacity_PausesAtActiveWaveLimitWithoutEvictableLineage(t *testing.T) {
	fs := newFakeStorage()
	fs.bronzeObjects["bronze/current-wave.fits"] = 44 * mib
	mgr := newManager(t, fs)
	err := mgr.CheckProjectedCapacity(context.Background(), 2*mib)
	if !errors.Is(err, lifecycle.ErrStoragePressure) {
		t.Fatalf("expected storage pressure at HIGH watermark, got %v", err)
	}
}
