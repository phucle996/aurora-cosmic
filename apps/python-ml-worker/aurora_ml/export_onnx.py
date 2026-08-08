"""ONNX Runtime Export & Python-to-ONNX Parity Verification (Phase 6.6).

Implements model-runtime-v1 and model-runtime-validation-v1 for Candidate Vetting
and Astronomical Anomaly Detection runtime packages.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
import os
import shutil
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import onnx
import onnxruntime as ort
import torch

from aurora_ml.ml.anomaly.model import AnomalyAutoencoderV1, ANOMALY_MODEL_INPUT_FEATURES
from aurora_ml.ml.anomaly.preprocessor import AnomalyPreprocessor
from aurora_ml.ml.candidate.model import CandidateTabularMlpV1, CANDIDATE_MODEL_INPUT_FEATURES
from aurora_ml.ml.candidate.preprocessor import CandidatePreprocessor
from aurora_ml.ml.registry import ModelRegistry, ModelPackageManifest


class OnnxExportError(Exception):
    """Base exception for ONNX Runtime Export failures."""

    pass


class OnnxParityError(OnnxExportError):
    """Raised when Python native vs ONNX Runtime deviation exceeds 1e-5 tolerance."""

    pass


@dataclass(frozen=True)
class ModelRuntimeManifest:
    """Immutable runtime package manifest conforming to model-runtime-v1."""

    schema_version: int
    runtime_package_id: str
    runtime_fingerprint: str
    task: str
    source_model_id: str
    source_model_manifest_sha256: str
    source_evaluation_run_id: str
    source_evaluation_manifest_sha256: str
    model_version: str
    preprocessing_version: str
    preprocessing_sha256: str
    threshold_policy_version: str
    threshold_sha256: str
    decision_threshold: float
    score_definition_version: str
    feature_order: List[str]
    onnx_export_version: str
    onnx_opset: int
    onnx_input_name: str
    onnx_input_shape: List[Optional[int]]
    onnx_output_name: str
    onnx_output_shape: List[Optional[int]]
    onnx_sha256: str
    onnx_size_bytes: int
    parity_fixture_version: str
    parity_fixture_sha256: str
    python_parity_policy_version: str
    python_parity_status: str
    created_at: str
    producer: str = "python-ml-worker"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass(frozen=True)
class ModelRuntimeValidationRecord:
    """Immutable validation record conforming to model-runtime-validation-v1."""

    schema_version: int
    validation_record_id: str
    runtime_package_id: str
    runtime_manifest_sha256: str
    engine: str
    parity_fixture_sha256: str
    max_absolute_error: float
    max_relative_error: float
    atol_limit: float
    rtol_limit: float
    validation_status: str
    created_at: str
    producer: str = "python-ml-worker"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def derive_runtime_package_identity(
    task: str,
    source_model_id: str,
    source_model_manifest_sha256: str,
    source_evaluation_run_id: str,
    source_evaluation_manifest_sha256: str,
    preprocessing_sha256: str,
    threshold_sha256: str,
    feature_order: List[str],
    model_version: str,
    score_definition_version: str,
    onnx_export_version: str,
    onnx_opset: int,
    onnx_sha256: str,
    parity_fixture_sha256: str,
) -> Tuple[str, str]:
    """Derive deterministic runtime package ID and SHA-256 fingerprint."""
    canonical_obj = {
        "feature_order": list(feature_order),
        "model_version": model_version,
        "onnx_export_version": onnx_export_version,
        "onnx_opset": onnx_opset,
        "onnx_sha256": onnx_sha256,
        "parity_fixture_sha256": parity_fixture_sha256,
        "preprocessing_sha256": preprocessing_sha256,
        "score_definition_version": score_definition_version,
        "source_evaluation_manifest_sha256": source_evaluation_manifest_sha256,
        "source_evaluation_run_id": source_evaluation_run_id,
        "source_model_id": source_model_id,
        "source_model_manifest_sha256": source_model_manifest_sha256,
        "task": task,
        "threshold_sha256": threshold_sha256,
    }
    canonical_json = json.dumps(canonical_obj, sort_keys=True, separators=(",", ":"))
    runtime_fp = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    runtime_package_id = f"runtime-v1-{runtime_fp[:12]}"
    return runtime_package_id, runtime_fp


def compute_file_sha256(path: str) -> str:
    """Compute SHA-256 hash of a file."""
    with open(path, "rb") as f:
        return hashlib.sha256(f.read()).hexdigest()


class RuntimeExporter:
    """Exports registered PyTorch models to ONNX Runtime Packages and verifies parity."""

    def __init__(self, registry_root: str = "models", runtime_root: str = "models/runtime"):
        self.registry_root = registry_root
        self.runtime_root = runtime_root

    def export_candidate_runtime_package(
        self,
        model_id: str,
        evaluation_run_manifest_path: str,
        validation_rows: Optional[List[Dict[str, Any]]] = None,
    ) -> ModelRuntimeManifest:
        """Export candidate model package to ONNX and verify Python native vs ONNX Runtime parity."""
        task = "candidate_vetting"
        pkg_dir = os.path.join(self.registry_root, "candidate", model_id)
        manifest_path = os.path.join(pkg_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            raise OnnxExportError(f"Candidate model package manifest not found: {manifest_path}")

        registry = ModelRegistry(self.registry_root)
        model_pkg = registry.load_model_manifest(manifest_path)

        # 1. Load evaluation manifest and threshold
        with open(evaluation_run_manifest_path, "r", encoding="utf-8") as f:
            eval_data = json.load(f)
        eval_manifest_sha = hashlib.sha256(
            json.dumps(eval_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        eval_dir = os.path.dirname(evaluation_run_manifest_path)
        threshold_path = os.path.join(eval_dir, "threshold.json")
        if os.path.exists(threshold_path):
            threshold_sha = compute_file_sha256(threshold_path)
            with open(threshold_path, "r", encoding="utf-8") as f:
                th_data = json.load(f)
            decision_threshold = float(th_data.get("decision_threshold", eval_data.get("decision_threshold", 0.5)))
        else:
            decision_threshold = float(eval_data.get("decision_threshold", 0.5))
            threshold_bytes = json.dumps({"decision_threshold": decision_threshold}, sort_keys=True).encode("utf-8")
            threshold_sha = hashlib.sha256(threshold_bytes).hexdigest()

        # 2. Rebuild PyTorch model on CPU
        device = torch.device("cpu")
        native_model = CandidateTabularMlpV1(input_dim=len(model_pkg.feature_order))
        model_pt_path = os.path.join(pkg_dir, "model.pt")
        state_dict = torch.load(model_pt_path, map_location=device, weights_only=True)
        native_model.load_state_dict(state_dict)
        native_model.eval()

        # 3. Export to ONNX (opset 17, dynamic batch)
        os.makedirs(os.path.join(self.runtime_root, "candidate"), exist_ok=True)
        temp_onnx_path = os.path.join(self.runtime_root, "candidate", f"temp_{model_id}.onnx")

        dummy_input = torch.randn(2, len(model_pkg.feature_order), dtype=torch.float32, device=device)
        torch.onnx.export(
            native_model,
            dummy_input,
            temp_onnx_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=["features"],
            output_names=["logits"],
            dynamic_axes={"features": {0: "batch"}, "logits": {0: "batch"}},
            dynamo=False,
        )

        # 4. Validate ONNX structure
        onnx_model = onnx.load(temp_onnx_path)
        onnx.checker.check_model(onnx_model)
        onnx_sha = compute_file_sha256(temp_onnx_path)
        onnx_size = os.path.getsize(temp_onnx_path)

        # 5. Load preprocessor
        prep_path = os.path.join(pkg_dir, "preprocessing.json")
        with open(prep_path, "r", encoding="utf-8") as f:
            prep_data = json.load(f)
        prep = CandidatePreprocessor(
            split_id=prep_data.get("split_id", ""),
            feature_order=tuple(model_pkg.feature_order),
            feature_medians=prep_data.get("feature_medians", {}),
            feature_means=prep_data.get("feature_means", {}),
            feature_scales=prep_data.get("feature_scales", {}),
        )

        # 6. Generate Parity Fixture (first 8 validation rows or synthetic canary)
        if validation_rows is None or len(validation_rows) == 0:
            # Synthetic canary rows
            sample_rows = []
            for i in range(8):
                row = {f: 1.0 + i * 0.1 for f in model_pkg.feature_order}
                sample_rows.append(row)
        else:
            sample_rows = validation_rows[:8]

        # Preprocess features
        raw_features_matrix = prep.transform_features(sample_rows)

        # PyTorch native prediction
        with torch.no_grad():
            native_logits = native_model(torch.tensor(raw_features_matrix, dtype=torch.float32)).numpy().flatten()
            native_scores = 1.0 / (1.0 + np.exp(-native_logits))

        # ONNX Runtime prediction
        ort_sess = ort.InferenceSession(temp_onnx_path, providers=["CPUExecutionProvider"])
        ort_outputs = ort_sess.run(["logits"], {"features": raw_features_matrix})
        ort_logits = ort_outputs[0].flatten()
        ort_scores = 1.0 / (1.0 + np.exp(-ort_logits))

        # Verify numerical parity (|diff| <= 1e-5)
        abs_diff = np.abs(native_logits - ort_logits)
        max_abs_err = float(np.max(abs_diff))
        max_rel_err = float(np.max(abs_diff / (np.abs(native_logits) + 1e-9)))

        if max_abs_err > 1e-5:
            if os.path.exists(temp_onnx_path):
                os.remove(temp_onnx_path)
            raise OnnxParityError(f"PYTHON_ONNX_PARITY_FAILED: max_abs_error={max_abs_err:.6e} > 1e-5")

        # Build parity-fixture.json
        fixture_cases = []
        for i, r in enumerate(sample_rows):
            above_th = bool(ort_scores[i] >= decision_threshold)
            fixture_cases.append({
                "case_id": f"cand-case-{i+1}",
                "raw_features": {k: r.get(k) for k in model_pkg.feature_order},
                "standardized_features": raw_features_matrix[i].tolist(),
                "expected_logit": float(ort_logits[i]),
                "expected_score": float(ort_scores[i]),
                "expected_above_threshold": above_th,
            })

        fixture_obj = {
            "schema_version": 1,
            "parity_fixture_version": "runtime-parity-fixture-v1",
            "task": task,
            "feature_order": model_pkg.feature_order,
            "decision_threshold": decision_threshold,
            "cases": fixture_cases,
        }
        fixture_bytes = json.dumps(fixture_obj, sort_keys=True, indent=2).encode("utf-8")
        fixture_sha = hashlib.sha256(fixture_bytes).hexdigest()

        # 7. Derive runtime package ID
        runtime_id, runtime_fp = derive_runtime_package_identity(
            task=task,
            source_model_id=model_id,
            source_model_manifest_sha256=model_pkg.model_fingerprint,
            source_evaluation_run_id=eval_data["evaluation_run_id"],
            source_evaluation_manifest_sha256=eval_manifest_sha,
            preprocessing_sha256=model_pkg.preprocessing_json_sha256,
            threshold_sha256=threshold_sha,
            feature_order=model_pkg.feature_order,
            model_version=model_pkg.model_version,
            score_definition_version="candidate-sigmoid-score-v1",
            onnx_export_version="onnx-export-v1",
            onnx_opset=17,
            onnx_sha256=onnx_sha,
            parity_fixture_sha256=fixture_sha,
        )

        # 8. Write runtime package files
        runtime_dir = os.path.join(self.runtime_root, "candidate", runtime_id)
        os.makedirs(runtime_dir, exist_ok=True)

        final_onnx_path = os.path.join(runtime_dir, "model.onnx")
        shutil.move(temp_onnx_path, final_onnx_path)

        # Copy preprocessing.json
        shutil.copyfile(prep_path, os.path.join(runtime_dir, "preprocessing.json"))

        # Write threshold.json
        with open(os.path.join(runtime_dir, "threshold.json"), "w", encoding="utf-8") as f:
            json.dump({"decision_threshold": decision_threshold}, f, indent=2, sort_keys=True)

        # Write parity-fixture.json
        with open(os.path.join(runtime_dir, "parity-fixture.json"), "wb") as f:
            f.write(fixture_bytes)

        # 9. Write manifest.json last as commit marker
        created_at = datetime.now(timezone.utc).isoformat()
        manifest = ModelRuntimeManifest(
            schema_version=1,
            runtime_package_id=runtime_id,
            runtime_fingerprint=runtime_fp,
            task=task,
            source_model_id=model_id,
            source_model_manifest_sha256=model_pkg.model_fingerprint,
            source_evaluation_run_id=eval_data["evaluation_run_id"],
            source_evaluation_manifest_sha256=eval_manifest_sha,
            model_version=model_pkg.model_version,
            preprocessing_version=model_pkg.preprocessing_version,
            preprocessing_sha256=model_pkg.preprocessing_json_sha256,
            threshold_policy_version=eval_data.get("threshold_policy_version", "candidate-threshold-max-f1-v1"),
            threshold_sha256=threshold_sha,
            decision_threshold=decision_threshold,
            score_definition_version="candidate-sigmoid-score-v1",
            feature_order=model_pkg.feature_order,
            onnx_export_version="onnx-export-v1",
            onnx_opset=17,
            onnx_input_name="features",
            onnx_input_shape=[-1, len(model_pkg.feature_order)],
            onnx_output_name="logits",
            onnx_output_shape=[-1],
            onnx_sha256=onnx_sha,
            onnx_size_bytes=onnx_size,
            parity_fixture_version="runtime-parity-fixture-v1",
            parity_fixture_sha256=fixture_sha,
            python_parity_policy_version="python-native-onnx-parity-v1",
            python_parity_status="PASS",
            created_at=created_at,
        )

        with open(os.path.join(runtime_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest.to_dict(), f, indent=2, sort_keys=True)

        return manifest

    def export_anomaly_runtime_package(
        self,
        model_id: str,
        evaluation_run_manifest_path: str,
        validation_rows: Optional[List[Dict[str, Any]]] = None,
    ) -> ModelRuntimeManifest:
        """Export anomaly model package to ONNX and verify Python native vs ONNX Runtime parity."""
        task = "astronomical_anomaly_detection"
        pkg_dir = os.path.join(self.registry_root, "anomaly", model_id)
        manifest_path = os.path.join(pkg_dir, "manifest.json")
        if not os.path.exists(manifest_path):
            raise OnnxExportError(f"Anomaly model package manifest not found: {manifest_path}")

        registry = ModelRegistry(self.registry_root)
        model_pkg = registry.load_model_manifest(manifest_path)

        # 1. Load evaluation manifest and threshold
        with open(evaluation_run_manifest_path, "r", encoding="utf-8") as f:
            eval_data = json.load(f)
        eval_manifest_sha = hashlib.sha256(
            json.dumps(eval_data, sort_keys=True, separators=(",", ":")).encode("utf-8")
        ).hexdigest()

        eval_dir = os.path.dirname(evaluation_run_manifest_path)
        threshold_path = os.path.join(eval_dir, "threshold.json")
        if os.path.exists(threshold_path):
            threshold_sha = compute_file_sha256(threshold_path)
            with open(threshold_path, "r", encoding="utf-8") as f:
                th_data = json.load(f)
            decision_threshold = float(th_data.get("decision_threshold", eval_data.get("decision_threshold", 0.05)))
        else:
            decision_threshold = float(eval_data.get("decision_threshold", 0.05))
            threshold_bytes = json.dumps({"decision_threshold": decision_threshold}, sort_keys=True).encode("utf-8")
            threshold_sha = hashlib.sha256(threshold_bytes).hexdigest()

        # 2. Rebuild PyTorch Autoencoder on CPU
        device = torch.device("cpu")
        native_model = AnomalyAutoencoderV1(input_dim=len(model_pkg.feature_order))
        model_pt_path = os.path.join(pkg_dir, "model.pt")
        state_dict = torch.load(model_pt_path, map_location=device, weights_only=True)
        native_model.load_state_dict(state_dict)
        native_model.eval()

        # 3. Export to ONNX (opset 17, dynamic batch)
        os.makedirs(os.path.join(self.runtime_root, "anomaly"), exist_ok=True)
        temp_onnx_path = os.path.join(self.runtime_root, "anomaly", f"temp_{model_id}.onnx")

        dummy_input = torch.randn(2, len(model_pkg.feature_order), dtype=torch.float32, device=device)
        torch.onnx.export(
            native_model,
            dummy_input,
            temp_onnx_path,
            export_params=True,
            opset_version=17,
            do_constant_folding=True,
            input_names=["features"],
            output_names=["reconstruction"],
            dynamic_axes={"features": {0: "batch"}, "reconstruction": {0: "batch"}},
            dynamo=False,
        )

        # 4. Validate ONNX structure
        onnx_model = onnx.load(temp_onnx_path)
        onnx.checker.check_model(onnx_model)
        onnx_sha = compute_file_sha256(temp_onnx_path)
        onnx_size = os.path.getsize(temp_onnx_path)

        # 5. Load preprocessor
        prep_path = os.path.join(pkg_dir, "preprocessing.json")
        with open(prep_path, "r", encoding="utf-8") as f:
            prep_data = json.load(f)
        prep = AnomalyPreprocessor(
            split_id=prep_data.get("split_id", ""),
            feature_order=tuple(model_pkg.feature_order),
            feature_medians=prep_data.get("feature_medians", {}),
            feature_means=prep_data.get("feature_means", {}),
            feature_scales=prep_data.get("feature_scales", {}),
        )

        # 6. Generate Parity Fixture
        if validation_rows is None or len(validation_rows) == 0:
            sample_rows = []
            for i in range(8):
                row = {f: 0.1 + i * 0.05 for f in model_pkg.feature_order}
                sample_rows.append(row)
        else:
            sample_rows = validation_rows[:8]

        raw_features_matrix = prep.transform_features(sample_rows)

        # PyTorch native prediction
        with torch.no_grad():
            native_recon = native_model(torch.tensor(raw_features_matrix, dtype=torch.float32)).numpy()
            native_mse = np.mean((raw_features_matrix - native_recon) ** 2, axis=1)

        # ONNX Runtime prediction
        ort_sess = ort.InferenceSession(temp_onnx_path, providers=["CPUExecutionProvider"])
        ort_outputs = ort_sess.run(["reconstruction"], {"features": raw_features_matrix})
        ort_recon = ort_outputs[0]
        ort_mse = np.mean((raw_features_matrix - ort_recon) ** 2, axis=1)

        # Verify parity
        abs_diff = np.abs(native_recon - ort_recon)
        max_abs_err = float(np.max(abs_diff))
        max_rel_err = float(np.max(abs_diff / (np.abs(native_recon) + 1e-9)))

        if max_abs_err > 1e-5:
            if os.path.exists(temp_onnx_path):
                os.remove(temp_onnx_path)
            raise OnnxParityError(f"PYTHON_ONNX_PARITY_FAILED: max_abs_error={max_abs_err:.6e} > 1e-5")

        # Build parity-fixture.json
        fixture_cases = []
        for i, r in enumerate(sample_rows):
            above_th = bool(ort_mse[i] >= decision_threshold)
            fixture_cases.append({
                "case_id": f"anom-case-{i+1}",
                "raw_features": {k: r.get(k) for k in model_pkg.feature_order},
                "standardized_features": raw_features_matrix[i].tolist(),
                "expected_reconstruction": ort_recon[i].tolist(),
                "expected_mse": float(ort_mse[i]),
                "expected_above_threshold": above_th,
            })

        fixture_obj = {
            "schema_version": 1,
            "parity_fixture_version": "runtime-parity-fixture-v1",
            "task": task,
            "feature_order": model_pkg.feature_order,
            "decision_threshold": decision_threshold,
            "cases": fixture_cases,
        }
        fixture_bytes = json.dumps(fixture_obj, sort_keys=True, indent=2).encode("utf-8")
        fixture_sha = hashlib.sha256(fixture_bytes).hexdigest()

        # 7. Derive runtime ID
        runtime_id, runtime_fp = derive_runtime_package_identity(
            task=task,
            source_model_id=model_id,
            source_model_manifest_sha256=model_pkg.model_fingerprint,
            source_evaluation_run_id=eval_data["evaluation_run_id"],
            source_evaluation_manifest_sha256=eval_manifest_sha,
            preprocessing_sha256=model_pkg.preprocessing_json_sha256,
            threshold_sha256=threshold_sha,
            feature_order=model_pkg.feature_order,
            model_version=model_pkg.model_version,
            score_definition_version="anomaly-reconstruction-mse-v1",
            onnx_export_version="onnx-export-v1",
            onnx_opset=17,
            onnx_sha256=onnx_sha,
            parity_fixture_sha256=fixture_sha,
        )

        # 8. Write runtime package files
        runtime_dir = os.path.join(self.runtime_root, "anomaly", runtime_id)
        os.makedirs(runtime_dir, exist_ok=True)

        final_onnx_path = os.path.join(runtime_dir, "model.onnx")
        shutil.move(temp_onnx_path, final_onnx_path)

        shutil.copyfile(prep_path, os.path.join(runtime_dir, "preprocessing.json"))

        with open(os.path.join(runtime_dir, "threshold.json"), "w", encoding="utf-8") as f:
            json.dump({"decision_threshold": decision_threshold}, f, indent=2, sort_keys=True)

        with open(os.path.join(runtime_dir, "parity-fixture.json"), "wb") as f:
            f.write(fixture_bytes)

        # 9. Write manifest.json last as commit marker
        created_at = datetime.now(timezone.utc).isoformat()
        manifest = ModelRuntimeManifest(
            schema_version=1,
            runtime_package_id=runtime_id,
            runtime_fingerprint=runtime_fp,
            task=task,
            source_model_id=model_id,
            source_model_manifest_sha256=model_pkg.model_fingerprint,
            source_evaluation_run_id=eval_data["evaluation_run_id"],
            source_evaluation_manifest_sha256=eval_manifest_sha,
            model_version=model_pkg.model_version,
            preprocessing_version=model_pkg.preprocessing_version,
            preprocessing_sha256=model_pkg.preprocessing_json_sha256,
            threshold_policy_version=eval_data.get("threshold_policy_version", "anomaly-threshold-validation-p99-v1"),
            threshold_sha256=threshold_sha,
            decision_threshold=decision_threshold,
            score_definition_version="anomaly-reconstruction-mse-v1",
            feature_order=model_pkg.feature_order,
            onnx_export_version="onnx-export-v1",
            onnx_opset=17,
            onnx_input_name="features",
            onnx_input_shape=[-1, len(model_pkg.feature_order)],
            onnx_output_name="reconstruction",
            onnx_output_shape=[-1, len(model_pkg.feature_order)],
            onnx_sha256=onnx_sha,
            onnx_size_bytes=onnx_size,
            parity_fixture_version="runtime-parity-fixture-v1",
            parity_fixture_sha256=fixture_sha,
            python_parity_policy_version="python-native-onnx-parity-v1",
            python_parity_status="PASS",
            created_at=created_at,
        )

        with open(os.path.join(runtime_dir, "manifest.json"), "w", encoding="utf-8") as f:
            json.dump(manifest.to_dict(), f, indent=2, sort_keys=True)

        return manifest
