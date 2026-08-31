package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"strings"
	"testing"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	"go-api/internal/taxonomy"
)

type memoryModelObjects struct{ objects map[string][]byte }

func (m *memoryModelObjects) Ping(context.Context) error { return nil }
func (m *memoryModelObjects) ListObjects(_ context.Context, prefix string) ([]repo.ObjectInfo, error) {
	items := make([]repo.ObjectInfo, 0)
	for key := range m.objects {
		if len(key) >= len(prefix) && key[:len(prefix)] == prefix {
			items = append(items, repo.ObjectInfo{Key: key})
		}
	}
	return items, nil
}
func (m *memoryModelObjects) GetObject(_ context.Context, key string) ([]byte, error) {
	data, ok := m.objects[key]
	if !ok {
		return nil, repo.ErrObjectNotFound
	}
	return data, nil
}
func (m *memoryModelObjects) PutObject(_ context.Context, key string, data []byte, _ string) error {
	m.objects[key] = data
	return nil
}
func (m *memoryModelObjects) DeleteObject(_ context.Context, key string) error {
	delete(m.objects, key)
	return nil
}

type recordingDispatcher struct {
	calls int
	err   error
}

type readyTrainingAnalytics struct{}

func (readyTrainingAnalytics) TrainingReadiness(_ context.Context, snapshotIDs []string) (*entity.TrainingReadiness, error) {
	return &entity.TrainingReadiness{Ready: true, SnapshotIDs: snapshotIDs, PositiveTargets: 2, NegativeTargets: 2}, nil
}

type blockedTrainingAnalytics struct{}

func (blockedTrainingAnalytics) TrainingReadiness(context.Context, []string) (*entity.TrainingReadiness, error) {
	return &entity.TrainingReadiness{
		Ready:           false,
		PositiveTargets: 1,
		NegativeTargets: 0,
		Blocker:         "Candidate training requires independently labelled positive and negative TIC targets",
	}, nil
}

func (d *recordingDispatcher) Dispatch(context.Context, string, []byte) error {
	d.calls++
	return d.err
}

func modelFixture(parity string) map[string][]byte {
	files := map[string][]byte{
		"models/runtime/candidate_vetting/model-a/runtime-a/model.onnx":          []byte("onnx"),
		"models/runtime/candidate_vetting/model-a/runtime-a/preprocessing.json":  []byte("preprocessing"),
		"models/runtime/candidate_vetting/model-a/runtime-a/threshold.json":      []byte("threshold"),
		"models/runtime/candidate_vetting/model-a/runtime-a/parity-fixture.json": []byte("fixture"),
	}
	hash := func(key string) string {
		digest := sha256.Sum256(files[key])
		return hex.EncodeToString(digest[:])
	}
	files["models/runtime/candidate_vetting/model-a/runtime-a/manifest.json"] = []byte(`{
        "runtime_package_id":"runtime-a", "task":"candidate_vetting", "source_model_id":"model-a",
        "onnx_sha256":"` + hash("models/runtime/candidate_vetting/model-a/runtime-a/model.onnx") + `",
        "preprocessing_sha256":"` + hash("models/runtime/candidate_vetting/model-a/runtime-a/preprocessing.json") + `",
        "threshold_sha256":"` + hash("models/runtime/candidate_vetting/model-a/runtime-a/threshold.json") + `",
        "parity_fixture_sha256":"` + hash("models/runtime/candidate_vetting/model-a/runtime-a/parity-fixture.json") + `",
        "python_parity_status":"` + parity + `"
    }`)
	return files
}

func TestInvalidRuntimeCannotAppearAsChampion(t *testing.T) {
	objects := &memoryModelObjects{objects: modelFixture("FAIL")}
	objects.objects["models/candidate/champion.json"] = []byte(`{"runtime_package_id":"runtime-a"}`)
	models, err := NewModelsService(objects, nil, readyTrainingAnalytics{}).ListModels(context.Background(), taxonomy.TaskCandidateVetting)
	if err != nil || len(models) != 1 {
		t.Fatalf("list models: %v, %#v", err, models)
	}
	if models[0].Status != taxonomy.ModelStatusInvalid {
		t.Fatalf("invalid runtime was promoted to %q", models[0].Status)
	}
}

func TestDeploymentPinsValidatedRuntimePackage(t *testing.T) {
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	service := NewModelsService(objects, nil, readyTrainingAnalytics{})
	if err := service.SetModelDeployment(context.Background(), "runtime-a", taxonomy.TaskCandidateVetting, true); err != nil {
		t.Fatalf("deploy runtime: %v", err)
	}
	pointer := string(objects.objects["models/candidate/champion.json"])
	if pointer == "" || !strings.Contains(pointer, `"runtime_package_id": "runtime-a"`) {
		t.Fatalf("champion pointer does not pin runtime package: %s", pointer)
	}
	if _, legacy := objects.objects["models/candidate_vetting/champion.json"]; legacy {
		t.Fatal("deployment wrote a second non-atomic legacy pointer")
	}
	if err := service.SetModelDeployment(context.Background(), "model-a", taxonomy.TaskCandidateVetting, true); err == nil {
		t.Fatal("source model id was accepted instead of immutable runtime package id")
	}
}

func TestTrainingRequiresCommittedSnapshotAndDispatcher(t *testing.T) {
	objects := &memoryModelObjects{objects: map[string][]byte{
		"gold/snapshots/gold-v1-committed/manifest.json": []byte(`{"snapshot_id":"gold-v1-committed","status":"COMMITTED"}`),
		"gold/snapshots/gold-v1-other/manifest.json":     []byte(`{"snapshot_id":"gold-v1-other","status":"COMMITTED"}`),
	}}
	service := NewModelsService(objects, nil, readyTrainingAnalytics{})
	if _, err := service.StartTrainingJob(context.Background(), entity.TrainingJobSpec{GoldSnapshotID: "gold-v1-committed"}); err == nil {
		t.Fatal("training was accepted without a dispatcher")
	}
	dispatcher := &recordingDispatcher{}
	service = NewModelsService(objects, dispatcher, readyTrainingAnalytics{})
	if _, err := service.StartTrainingJob(context.Background(), entity.TrainingJobSpec{GoldSnapshotID: "gold-v1-missing"}); err == nil {
		t.Fatal("training was accepted for a missing snapshot")
	}
	result, err := service.StartTrainingJob(context.Background(), entity.TrainingJobSpec{GoldSnapshotIDs: []string{"gold-v1-other", "gold-v1-committed"}})
	if err != nil || len(result.GoldSnapshotIDs) != 2 || result.GoldSnapshotIDs[0] != "gold-v1-committed" {
		t.Fatalf("multi-snapshot training was not normalized and dispatched: result=%#v err=%v", result, err)
	}
	if _, err := service.StartTrainingJob(context.Background(), entity.TrainingJobSpec{GoldSnapshotID: "gold-v1-committed", Task: "unknown"}); err == nil {
		t.Fatal("training accepted unknown task")
	}
	if _, err := service.StartTrainingJob(context.Background(), entity.TrainingJobSpec{GoldSnapshotID: "gold-v1-committed"}); err != nil || dispatcher.calls != 2 {
		t.Fatalf("committed training was not dispatched: %v, calls=%d", err, dispatcher.calls)
	}
}

func TestTrainingRejectsCandidateGoldWithoutTwoLabelClasses(t *testing.T) {
	objects := &memoryModelObjects{objects: map[string][]byte{
		"gold/snapshots/gold-v1-candidate-only/manifest.json": []byte(`{"snapshot_id":"gold-v1-candidate-only","status":"COMMITTED"}`),
	}}
	dispatcher := &recordingDispatcher{}
	service := NewModelsService(objects, dispatcher, blockedTrainingAnalytics{})
	_, err := service.StartTrainingJob(context.Background(), entity.TrainingJobSpec{
		GoldSnapshotID: "gold-v1-candidate-only",
		TrainingMode:   "scratch",
	})
	if err == nil || !strings.Contains(err.Error(), "not a supervised training cohort") {
		t.Fatalf("expected supervised cohort guard, got %v", err)
	}
	if dispatcher.calls != 0 {
		t.Fatalf("blocked cohort was dispatched %d times", dispatcher.calls)
	}
}

var _ repo.ObjectRepository = (*memoryModelObjects)(nil)
var _ repo.InferenceDispatcher = (*recordingDispatcher)(nil)
var _ repo.TrainingReadinessRepository = readyTrainingAnalytics{}
var _ repo.TrainingReadinessRepository = blockedTrainingAnalytics{}
