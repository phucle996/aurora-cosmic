"""Anomaly Light-Curve Preprocessor Specification (anomaly-lightcurve-preprocess-v1).

Strictly fits TRAIN split rows for median imputation and standardization.
"""

import json
import math
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from aurora_ml.ml.datasets.splits import ANOMALY_MODEL_INPUT_FEATURES


class AnomalyPreprocessingError(Exception):
    """Base exception for anomaly preprocessing errors."""
    pass


@dataclass
class AnomalyPreprocessor:
    """Imputation & Standardization Preprocessor for Anomaly LC Models.

    Fits medians, means, and scales strictly on TRAIN split rows.
    """

    preprocessing_version: str = "anomaly-lightcurve-preprocess-v1"
    split_id: str = ""
    feature_order: Tuple[str, ...] = ANOMALY_MODEL_INPUT_FEATURES
    feature_medians: Dict[str, float] = field(default_factory=dict)
    feature_means: Dict[str, float] = field(default_factory=dict)
    feature_scales: Dict[str, float] = field(default_factory=dict)
    schema_version: int = 1

    def fit(self, train_rows: List[Dict[str, Any]], split_id: str = "") -> "AnomalyPreprocessor":
        """Fit preprocessor statistics strictly on TRAIN split rows."""
        if not train_rows:
            raise AnomalyPreprocessingError("EMPTY_TRAIN_ROWS: Cannot fit preprocessor on empty train rows")

        self.split_id = split_id
        medians: Dict[str, float] = {}
        means: Dict[str, float] = {}
        scales: Dict[str, float] = {}

        for feat in self.feature_order:
            raw_vals = []
            for r in train_rows:
                val = r.get(feat)
                if val is not None:
                    try:
                        fval = float(val)
                        if not math.isnan(fval) and not math.isinf(fval):
                            raw_vals.append(fval)
                    except (ValueError, TypeError):
                        pass

            if not raw_vals:
                medians[feat] = 0.0
                means[feat] = 0.0
                scales[feat] = 1.0
            else:
                arr = np.array(raw_vals, dtype=np.float64)
                med = float(np.median(arr))
                mn = float(np.mean(arr))
                std = float(np.std(arr))

                medians[feat] = med
                means[feat] = mn
                scales[feat] = std if std > 1e-12 else 1.0

        self.feature_medians = medians
        self.feature_means = means
        self.feature_scales = scales
        return self

    def transform_features(self, rows: List[Dict[str, Any]]) -> np.ndarray:
        """Transform input rows to a 2D float32 standardized feature matrix."""
        if not self.feature_medians:
            raise AnomalyPreprocessingError("UNFITTED_PREPROCESSOR: Must call fit() before transform()")

        n_rows = len(rows)
        n_feats = len(self.feature_order)
        out = np.zeros((n_rows, n_feats), dtype=np.float32)

        for i, r in enumerate(rows):
            for j, feat in enumerate(self.feature_order):
                val = r.get(feat)
                med = self.feature_medians[feat]
                mn = self.feature_means[feat]
                scale = self.feature_scales[feat]

                fval = med
                if val is not None:
                    try:
                        v = float(val)
                        if not math.isnan(v) and not math.isinf(v):
                            fval = v
                    except (ValueError, TypeError):
                        pass

                z = (fval - mn) / scale
                out[i, j] = np.float32(z)

        return out

    def to_dict(self) -> Dict[str, Any]:
        """Serialize preprocessor state to dict."""
        return {
            "schema_version": self.schema_version,
            "preprocessing_version": self.preprocessing_version,
            "split_id": self.split_id,
            "feature_order": list(self.feature_order),
            "feature_medians": self.feature_medians,
            "feature_means": self.feature_means,
            "feature_scales": self.feature_scales,
        }

    def to_json(self, indent: Optional[int] = 2) -> str:
        """Serialize preprocessor state to JSON string."""
        return json.dumps(self.to_dict(), indent=indent, sort_keys=True)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "AnomalyPreprocessor":
        """Instantiate AnomalyPreprocessor from dict."""
        if d.get("schema_version", 1) != 1:
            raise AnomalyPreprocessingError(f"Unsupported schema version: {d.get('schema_version')}")

        return cls(
            schema_version=d.get("schema_version", 1),
            preprocessing_version=d.get("preprocessing_version", "anomaly-lightcurve-preprocess-v1"),
            split_id=d.get("split_id", ""),
            feature_order=tuple(d.get("feature_order", ANOMALY_MODEL_INPUT_FEATURES)),
            feature_medians=dict(d.get("feature_medians", {})),
            feature_means=dict(d.get("feature_means", {})),
            feature_scales=dict(d.get("feature_scales", {})),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "AnomalyPreprocessor":
        """Instantiate AnomalyPreprocessor from JSON string."""
        d = json.loads(json_str)
        return cls.from_dict(d)
