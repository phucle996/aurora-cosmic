package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
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
	calls           int
	err             error
	coreEvents      int
	canaryStatus    string
	canaryRuntimeID string
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

func (d *recordingDispatcher) PublishCore(context.Context, string, []byte) error {
	d.coreEvents++
	return d.err
}

func (d *recordingDispatcher) RequestCore(_ context.Context, _ string, payload []byte) ([]byte, error) {
	if d.err != nil {
		return nil, d.err
	}
	var request struct {
		RuntimePackageID string `json:"runtime_package_id"`
	}
	if err := json.Unmarshal(payload, &request); err != nil {
		return nil, err
	}
	status := d.canaryStatus
	if status == "" {
		status = "PASS"
	}
	runtimeID := d.canaryRuntimeID
	if runtimeID == "" {
		runtimeID = request.RuntimePackageID
	}
	return json.Marshal(map[string]any{
		"status": status, "runtime_package_id": runtimeID,
		"runtime_validation_id": "rval-v1-test", "engine": "rust-inference-ort",
		"max_absolute_error": 0.000001, "max_relative_error": 0.000002,
	})
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

func TestGetModelEvaluationReadsVerifiedEvidence(t *testing.T) {
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	runtimeKey := "models/runtime/candidate_vetting/model-a/runtime-a/manifest.json"
	objects.objects[runtimeKey] = []byte(strings.Replace(
		string(objects.objects[runtimeKey]),
		`"python_parity_status":"PASS"`,
		`"python_parity_status":"PASS", "source_evaluation_run_id":"eval-cand-v1-test", "model_version":"1.0.0"`,
		1,
	))

	metrics := []byte(`{"golden_pr_auc":0.91,"golden_roc_auc":0.94,"golden_precision":0.8,"golden_recall":0.75,"golden_f1":0.774,"golden_confusion_matrix":[[18,2],[3,9]],"golden_row_count":32,"golden_positive_count":12,"golden_negative_count":20,"recent_pr_auc":0.88,"recent_recall":0.70,"recent_confusion_matrix":[[17,3],[4,8]],"recent_row_count":32,"recent_positive_count":12,"recent_negative_count":20,"pr_auc_drift":-0.03,"recall_drift":-0.05}`)
	threshold := []byte(`{"decision_threshold":0.63,"validation_row_count":40,"validation_precision":0.82,"validation_recall":0.78,"validation_f1":0.80}`)
	metricsSHA := sha256.Sum256(metrics)
	thresholdSHA := sha256.Sum256(threshold)
	prefix := "models/evaluations/candidate/eval-cand-v1-test/"
	objects.objects[prefix+"metrics.json"] = metrics
	objects.objects[prefix+"threshold.json"] = threshold
	objects.objects[prefix+"manifest.json"] = []byte(fmt.Sprintf(`{"evaluation_run_id":"eval-cand-v1-test","training_run_id":"train-test","model_version":"1.0.0","golden_cohort_id":"golden-test","recent_cohort_id":"recent-test","evaluation_policy_version":"candidate-evaluation-v1","threshold_policy_version":"candidate-threshold-max-f1-v1","decision_threshold":0.63,"threshold_sha256":"%x","metrics_sha256":"%x","created_at":"2026-09-02T00:00:00Z"}`, thresholdSHA, metricsSHA))
	objects.objects["models/registry/candidate/model-a/manifest.json"] = []byte(`{"model_id":"model-a","training_run_id":"train-test","training_run_manifest_sha256":"train-sha","evaluation_run_id":"eval-cand-v1-test","evaluation_run_manifest_sha256":"eval-sha","gold_snapshot_id":"gold-v1-test","gold_manifest_sha256":"gold-sha","split_id":"split-test","dataset_view_version":"candidate-ml-view-v2","dataset_view_fingerprint":"dataset-sha"}`)

	evaluation, err := NewModelsService(objects, nil, readyTrainingAnalytics{}).GetModelEvaluation(context.Background(), "runtime-a")
	if err != nil {
		t.Fatalf("get evaluation: %v", err)
	}
	if evaluation.Golden.PRAUC == nil || *evaluation.Golden.PRAUC != 0.91 || evaluation.Golden.ConfusionMatrix[1][0] != 3 {
		t.Fatalf("unexpected golden evidence: %#v", evaluation.Golden)
	}
	if evaluation.Recent == nil || evaluation.PRAUCDrift == nil || *evaluation.PRAUCDrift != -0.03 {
		t.Fatalf("unexpected recent evidence: %#v", evaluation)
	}
	if evaluation.DecisionThreshold != 0.63 || evaluation.ValidationRowCount != 40 {
		t.Fatalf("unexpected threshold evidence: %#v", evaluation)
	}
	if evaluation.GoldSnapshotID != "gold-v1-test" || evaluation.SplitID != "split-test" || evaluation.DatasetViewFingerprint != "dataset-sha" {
		t.Fatalf("unexpected model package provenance: %#v", evaluation)
	}
}

func TestDeploymentPinsValidatedRuntimePackage(t *testing.T) {
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	dispatcher := &recordingDispatcher{}
	service := NewModelsService(objects, dispatcher, readyTrainingAnalytics{})
	result, err := service.SetModelDeployment(context.Background(), "runtime-a", taxonomy.TaskCandidateVetting, true, "b6f13230-64c7-4b70-a513-56e4e832af31")
	if err != nil {
		t.Fatalf("deploy runtime: %v", err)
	}
	if result.RuntimeValidation != "rval-v1-test" || dispatcher.coreEvents < 4 {
		t.Fatalf("promotion did not retain canary evidence: result=%#v events=%d", result, dispatcher.coreEvents)
	}
	pointer := string(objects.objects["models/candidate/champion.json"])
	if pointer == "" || !strings.Contains(pointer, `"runtime_package_id": "runtime-a"`) || !strings.Contains(pointer, `"runtime_validation_id": "rval-v1-test"`) {
		t.Fatalf("champion pointer does not pin runtime package: %s", pointer)
	}
	if _, legacy := objects.objects["models/candidate_vetting/champion.json"]; legacy {
		t.Fatal("deployment wrote a second non-atomic legacy pointer")
	}
	if _, err := service.SetModelDeployment(context.Background(), "model-a", taxonomy.TaskCandidateVetting, true, "a9e19cc9-14c0-49d3-9fea-2fd0203bb9fa"); err == nil {
		t.Fatal("source model id was accepted instead of immutable runtime package id")
	}
}

func TestDeploymentKeepsPriorChampionWhenRuntimeCanaryFails(t *testing.T) {
	objects := &memoryModelObjects{objects: modelFixture("PASS")}
	objects.objects["models/candidate/champion.json"] = []byte(`{"runtime_package_id":"runtime-prior"}`)
	dispatcher := &recordingDispatcher{canaryStatus: "FAIL"}
	service := NewModelsService(objects, dispatcher, readyTrainingAnalytics{})
	if _, err := service.SetModelDeployment(context.Background(), "runtime-a", taxonomy.TaskCandidateVetting, true, "8b26dc45-ce4e-4bc0-aac9-aa81f784358d"); err == nil {
		t.Fatal("promotion succeeded despite failed Rust runtime canary")
	}
	if string(objects.objects["models/candidate/champion.json"]) != `{"runtime_package_id":"runtime-prior"}` {
		t.Fatal("failed canary changed the prior champion pointer")
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
var _ repo.ModelPromotionBus = (*recordingDispatcher)(nil)
var _ repo.TrainingReadinessRepository = readyTrainingAnalytics{}
var _ repo.TrainingReadinessRepository = blockedTrainingAnalytics{}
