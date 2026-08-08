"""Candidate Preprocessor Module (candidate-preprocess-v1).

Fits missing value imputation and feature standardization strictly on TRAIN split rows.
"""

from dataclasses import dataclass
import json
import math
from typing import Any, Dict, List, Optional, Tuple

import numpy as np

from aurora_ml.ml.datasets.splits import CANDIDATE_MODEL_INPUT_FEATURES


class PreprocessingError(Exception):
    """Base exception for preprocessor failures."""

    pass


@dataclass
class CandidatePreprocessor:
    """Preprocessor for candidate tabular model features (candidate-preprocess-v1)."""

    preprocessing_version: str = "candidate-preprocess-v1"
    split_id: str = ""
    feature_order: Tuple[str, ...] = CANDIDATE_MODEL_INPUT_FEATURES
    feature_medians: Dict[str, float] = None
    feature_means: Dict[str, float] = None
    feature_scales: Dict[str, float] = None
    label_encoding: Dict[str, int] = None
    schema_version: int = 1

    def __post_init__(self):
        if self.feature_medians is None:
            self.feature_medians = {}
        if self.feature_means is None:
            self.feature_means = {}
        if self.feature_scales is None:
            self.feature_scales = {}
        if self.label_encoding is None:
            self.label_encoding = {"NEGATIVE": 0, "POSITIVE": 1}

    def fit(
        self,
        train_rows: List[Dict[str, Any]],
        feature_order: Optional[Any] = None,
        split_id: str = "",
        **kwargs: Any,
    ) -> "CandidatePreprocessor":
        """Fit preprocessor statistics on TRAIN rows.

        Works both as an instance method (``prep.fit(rows)``) and as a class-level
        call (``CandidatePreprocessor.fit(rows, ...)``), which creates a new instance.
        """
        if not train_rows:
            raise PreprocessingError("EMPTY_TRAIN_ROWS: Cannot fit preprocessor on empty train rows")

        if feature_order is not None:
            if isinstance(feature_order, str):
                self.split_id = feature_order
            elif isinstance(feature_order, (list, tuple)):
                self.feature_order = tuple(feature_order)
        if split_id:
            self.split_id = split_id
        if "feature_order" in kwargs and kwargs["feature_order"]:
            self.feature_order = tuple(kwargs["feature_order"])
        if "split_id" in kwargs and kwargs["split_id"]:
            self.split_id = str(kwargs["split_id"])

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
                # Constant feature scale policy: if std == 0, scale = 1.0
                scales[feat] = std if std > 1e-12 else 1.0

        self.feature_medians = medians
        self.feature_means = means
        self.feature_scales = scales
        return self

    def __init_subclass__(cls, **kwargs: Any) -> None:  # noqa: D105
        super().__init_subclass__(**kwargs)

    @classmethod
    def _class_fit(
        cls,
        train_rows: List[Dict[str, Any]],
        feature_order: Optional[Any] = None,
        split_id: str = "",
        **kwargs: Any,
    ) -> "CandidatePreprocessor":
        """Class-level factory: create and fit a new instance."""
        inst = cls()
        return inst.fit(train_rows, feature_order=feature_order, split_id=split_id, **kwargs)

    def transform_features(self, rows: List[Dict[str, Any]]) -> np.ndarray:
        """Transform rows to float32 feature matrix (N, 32) using fitted TRAIN stats."""
        if not self.feature_medians or not self.feature_means or not self.feature_scales:
            raise PreprocessingError("NOT_FITTED: Preprocessor must be fitted before transforming")

        n_rows = len(rows)
        n_feats = len(self.feature_order)
        matrix = np.zeros((n_rows, n_feats), dtype=np.float32)

        for i, r in enumerate(rows):
            for j, feat in enumerate(self.feature_order):
                val = r.get(feat)
                med = self.feature_medians[feat]
                mn = self.feature_means[feat]
                scale = self.feature_scales[feat]

                # Impute missing/nan/inf with TRAIN median
                if val is None:
                    fval = med
                else:
                    try:
                        fval = float(val)
                        if math.isnan(fval) or math.isinf(fval):
                            fval = med
                    except (ValueError, TypeError):
                        fval = med

                # Standardize using TRAIN mean and scale
                norm_val = (fval - mn) / scale
                matrix[i, j] = np.float32(norm_val)

        # Invariant: Output matrix contains 0 NaN/Inf
        if np.isnan(matrix).any() or np.isinf(matrix).any():
            raise PreprocessingError("NON_FINITE_TRANSFORM: Transformed matrix contains NaN or Inf")

        return matrix

    def transform_labels(self, rows: List[Dict[str, Any]]) -> np.ndarray:
        """Transform training_label values to float32 targets array (N, 1)."""
        n_rows = len(rows)
        targets = np.zeros((n_rows, 1), dtype=np.float32)

        for i, r in enumerate(rows):
            label = r.get("training_label")
            if label not in self.label_encoding:
                raise PreprocessingError(
                    f"UNSUPPORTED_LABEL: Label '{label}' is not in supervised encoding {self.label_encoding}"
                )
            targets[i, 0] = np.float32(self.label_encoding[label])

        return targets

    def to_dict(self) -> Dict[str, Any]:
        """Serialize preprocessor state to dictionary for JSON persistence."""
        return {
            "schema_version": self.schema_version,
            "preprocessing_version": self.preprocessing_version,
            "split_id": self.split_id,
            "feature_order": list(self.feature_order),
            "feature_medians": self.feature_medians,
            "feature_means": self.feature_means,
            "feature_scales": self.feature_scales,
            "label_encoding": self.label_encoding,
        }

    def to_json(self, indent: int = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "CandidatePreprocessor":
        """Reconstruct preprocessor state from dictionary."""
        return cls(
            schema_version=d.get("schema_version", 1),
            preprocessing_version=d.get("preprocessing_version", "candidate-preprocess-v1"),
            split_id=d.get("split_id", ""),
            feature_order=tuple(d.get("feature_order", CANDIDATE_MODEL_INPUT_FEATURES)),
            feature_medians=d.get("feature_medians", {}),
            feature_means=d.get("feature_means", {}),
            feature_scales=d.get("feature_scales", {}),
            label_encoding=d.get("label_encoding", {"NEGATIVE": 0, "POSITIVE": 1}),
        )

    @classmethod
    def from_json(cls, json_str: str) -> "CandidatePreprocessor":
        return cls.from_dict(json.loads(json_str))
