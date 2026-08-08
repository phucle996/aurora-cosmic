package service

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"fmt"
	"sort"
	"strings"

	"go-api/internal/domain/entity"
	"go-api/internal/domain/repo"
	domainService "go-api/internal/domain/service"
)

type ModelsService struct{ objects repo.ObjectRepository }

func NewModelsService(objects repo.ObjectRepository) domainService.Models {
	return &ModelsService{objects: objects}
}

type runtimeManifestDTO struct {
	RuntimePackageID      string   `json:"runtime_package_id"`
	Task                  string   `json:"task"`
	SourceModelID         string   `json:"source_model_id"`
	ModelVersion          string   `json:"model_version"`
	PreprocessingVersion  string   `json:"preprocessing_version"`
	PreprocessingSHA256   string   `json:"preprocessing_sha256"`
	ThresholdSHA256       string   `json:"threshold_sha256"`
	ParityFixtureSHA256   string   `json:"parity_fixture_sha256"`
	FeatureOrder          []string `json:"feature_order"`
	ONNXSizeBytes         int64    `json:"onnx_size_bytes"`
	ONNXSHA256            string   `json:"onnx_sha256"`
	DecisionThreshold     float64  `json:"decision_threshold"`
	PythonParityStatus    string   `json:"python_parity_status"`
	SourceEvaluationRunID string   `json:"source_evaluation_run_id"`
	CreatedAt             string   `json:"created_at"`
}

func (s *ModelsService) ListModels(ctx context.Context, task string) ([]entity.Model, error) {
	objects, err := s.objects.ListObjects(ctx, "models/runtime/")
	if err != nil {
		return nil, err
	}
	models := make([]entity.Model, 0)
	for _, object := range objects {
		parts := strings.Split(object.Key, "/")
		if len(parts) != 5 || parts[0] != "models" || parts[1] != "runtime" || parts[4] != "manifest.json" {
			continue
		}
		data, err := s.objects.GetObject(ctx, object.Key)
		if err != nil {
			continue
		}
		var manifest runtimeManifestDTO
		if json.Unmarshal(data, &manifest) != nil || manifest.RuntimePackageID == "" || manifest.SourceModelID == "" {
			continue
		}

		normTask := entity.TaskAnomalyDetection
		if strings.EqualFold(strings.TrimSpace(manifest.Task), "candidate") || strings.EqualFold(strings.TrimSpace(manifest.Task), string(entity.TaskCandidateVetting)) {
			normTask = entity.TaskCandidateVetting
		}
		if task != "" && string(normTask) != task {
			continue
		}

		integrityOK := true
		checks := []struct{ name, sum string }{
			{"model.onnx", manifest.ONNXSHA256},
			{"preprocessing.json", manifest.PreprocessingSHA256},
			{"threshold.json", manifest.ThresholdSHA256},
			{"parity-fixture.json", manifest.ParityFixtureSHA256},
		}
		for _, check := range checks {
			if check.sum == "" {
				integrityOK = false
				break
			}
			fileData, err := s.objects.GetObject(ctx, strings.TrimSuffix(object.Key, "manifest.json")+check.name)
			if err != nil {
				integrityOK = false
				break
			}
			sumBytes := sha256.Sum256(fileData)
			if hex.EncodeToString(sumBytes[:]) != check.sum {
				integrityOK = false
				break
			}
		}

		status := string(entity.ModelStatusValidated)
		if manifest.PythonParityStatus != "PASS" || !integrityOK {
			status = string(entity.ModelStatusInvalid)
		}

		taskDir := "anomaly"
		if normTask == entity.TaskCandidateVetting {
			taskDir = "candidate"
		}
		if champData, err := s.objects.GetObject(ctx, fmt.Sprintf("models/%s/champion.json", taskDir)); err == nil {
			var pointer struct {
				ModelID string `json:"model_id"`
			}
			if json.Unmarshal(champData, &pointer) == nil && pointer.ModelID == manifest.SourceModelID {
				status = string(entity.ModelStatusChampion)
			}
		}

		integrityStatus := "FAIL"
		if integrityOK {
			integrityStatus = "PASS"
		}

		models = append(models, entity.Model{
			ModelID:              manifest.SourceModelID,
			RuntimePackageID:     manifest.RuntimePackageID,
			Task:                 manifest.Task,
			ModelVersion:         manifest.ModelVersion,
			Status:               status,
			RuntimeManifestKey:   object.Key,
			PreprocessingVersion: manifest.PreprocessingVersion,
			FeatureCount:         len(manifest.FeatureOrder),
			FeatureOrder:         manifest.FeatureOrder,
			ONNXSizeBytes:        manifest.ONNXSizeBytes,
			ONNXSHA256:           manifest.ONNXSHA256,
			DecisionThreshold:    manifest.DecisionThreshold,
			ParityStatus:         manifest.PythonParityStatus,
			IntegrityStatus:      integrityStatus,
			EvaluationRunID:      manifest.SourceEvaluationRunID,
			CreatedAt:            manifest.CreatedAt,
		})
	}
	sort.Slice(models, func(i, j int) bool {
		if models[i].Task == models[j].Task {
			return models[i].CreatedAt > models[j].CreatedAt
		}
		return models[i].Task < models[j].Task
	})
	return models, nil
}
