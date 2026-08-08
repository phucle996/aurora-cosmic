"""Gold Dataset Snapshot Contract, Identity, and Planning Models.

Stage 5 Gold snapshot management for AURORA.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from typing import Any, Dict, List, Optional, Tuple


@dataclass(frozen=True)
class SilverInputRef:
    """Immutable reference to a verified Silver Parquet artifact."""

    lineage_id: str
    source_product_id: str
    product_kind: str
    silver_bucket: str
    silver_object_key: str
    silver_sha256: str
    silver_schema_version: str
    processor_version: str
    sample_id: Optional[str] = None

    def canonical_dict(self) -> Dict[str, Any]:
        """Return canonical dictionary for deterministic fingerprint calculation."""
        return {
            "lineage_id": self.lineage_id,
            "processor_version": self.processor_version,
            "product_kind": self.product_kind,
            "sample_id": self.sample_id,
            "silver_object_key": self.silver_object_key,
            "silver_schema_version": self.silver_schema_version,
            "silver_sha256": self.silver_sha256,
            "source_product_id": self.source_product_id,
        }

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "SilverInputRef":
        return cls(
            lineage_id=d["lineage_id"],
            source_product_id=d["source_product_id"],
            product_kind=d["product_kind"],
            silver_bucket=d.get("silver_bucket", "aurora-silver"),
            silver_object_key=d["silver_object_key"],
            silver_sha256=d["silver_sha256"],
            silver_schema_version=d["silver_schema_version"],
            processor_version=d["processor_version"],
            sample_id=d.get("sample_id"),
        )


def sort_silver_inputs(inputs: List[SilverInputRef]) -> List[SilverInputRef]:
    """Sort Silver inputs deterministically independent of MinIO list order."""
    return sorted(
        inputs,
        key=lambda inp: (
            inp.product_kind,
            inp.source_product_id,
            inp.processor_version,
            inp.silver_object_key,
        ),
    )


def derive_snapshot_identity(
    snapshot_type: str,
    gold_schema_version: str,
    feature_versions: Dict[str, str],
    inputs: List[SilverInputRef],
    catalog_snapshots: Optional[Dict[str, str]] = None,
    label_snapshots: Optional[Dict[str, str]] = None,
) -> Tuple[str, str]:
    """Derive deterministic (snapshot_id, snapshot_fingerprint) tuple.

    Derivation uses SHA256 of canonical JSON representation. Wall-clock timestamps,
    hostnames, Python hash(), and random UUIDs are strictly excluded.
    """
    sorted_inputs = sort_silver_inputs(inputs)
    canonical_inputs = [inp.canonical_dict() for inp in sorted_inputs]

    canonical_obj = {
        "catalog_snapshots": dict(sorted((catalog_snapshots or {}).items())),
        "feature_versions": dict(sorted((feature_versions or {}).items())),
        "gold_schema_version": gold_schema_version,
        "identity_version": "gold-snapshot-id-v1",
        "inputs": canonical_inputs,
        "label_snapshots": dict(sorted((label_snapshots or {}).items())),
        "snapshot_type": snapshot_type.upper(),
    }

    canonical_json = json.dumps(
        canonical_obj, sort_keys=True, separators=(",", ":")
    )
    digest = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()
    snapshot_fingerprint = digest
    snapshot_id = f"gold-v1-{digest[:12]}"
    return snapshot_id, snapshot_fingerprint


@dataclass
class GoldSnapshotManifest:
    """Immutable manifest specification for a committed or planned Gold Snapshot."""

    snapshot_id: str
    snapshot_fingerprint: str
    snapshot_type: str
    gold_schema_version: str
    feature_versions: Dict[str, str]
    input_count: int
    inputs: List[SilverInputRef]
    schema_version: int = 1
    catalog_snapshots: Dict[str, str] = field(default_factory=dict)
    label_snapshots: Dict[str, str] = field(default_factory=dict)
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    producer: str = "python-ml-worker"

    def validate(self) -> None:
        """Validate manifest invariants."""
        if self.schema_version != 1:
            raise ValueError(
                f"Unsupported manifest schema_version: {self.schema_version}"
            )
        if not self.snapshot_id or not self.snapshot_id.startswith("gold-v1-"):
            raise ValueError(f"Invalid snapshot_id format: '{self.snapshot_id}'")
        if (
            not self.snapshot_fingerprint
            or len(self.snapshot_fingerprint) != 64
        ):
            raise ValueError("snapshot_fingerprint must be a 64-char SHA256 hex string")
        if self.snapshot_type not in ("CANDIDATE", "ANOMALY"):
            raise ValueError(
                f"Unsupported snapshot_type: '{self.snapshot_type}'"
            )
        if self.input_count != len(self.inputs):
            raise ValueError(
                f"input_count mismatch: expected {len(self.inputs)}, got {self.input_count}"
            )

        # Check for duplicates in inputs
        seen_keys = set()
        for inp in self.inputs:
            key = (inp.product_kind, inp.source_product_id, inp.processor_version)
            if key in seen_keys:
                raise ValueError(f"Duplicate Silver input detected: {key}")
            seen_keys.add(key)

    def to_dict(self) -> Dict[str, Any]:
        d = {
            "schema_version": self.schema_version,
            "snapshot_id": self.snapshot_id,
            "snapshot_fingerprint": self.snapshot_fingerprint,
            "snapshot_type": self.snapshot_type,
            "gold_schema_version": self.gold_schema_version,
            "feature_versions": self.feature_versions,
            "input_count": self.input_count,
            "inputs": [inp.to_dict() for inp in self.inputs],
            "catalog_snapshots": self.catalog_snapshots,
            "label_snapshots": self.label_snapshots,
            "created_at": self.created_at,
            "producer": self.producer,
        }
        return d

    def to_json(self, indent: Optional[int] = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "GoldSnapshotManifest":
        inputs = [SilverInputRef.from_dict(i) for i in d.get("inputs", [])]
        manifest = cls(
            schema_version=d.get("schema_version", 1),
            snapshot_id=d["snapshot_id"],
            snapshot_fingerprint=d["snapshot_fingerprint"],
            snapshot_type=d["snapshot_type"],
            gold_schema_version=d["gold_schema_version"],
            feature_versions=d.get("feature_versions", {}),
            input_count=d.get("input_count", len(inputs)),
            inputs=inputs,
            catalog_snapshots=d.get("catalog_snapshots", {}),
            label_snapshots=d.get("label_snapshots", {}),
            created_at=d.get("created_at", ""),
            producer=d.get("producer", "python-ml-worker"),
        )
        manifest.validate()
        return manifest

    @classmethod
    def from_json(cls, s: str) -> "GoldSnapshotManifest":
        return cls.from_dict(json.loads(s))


@dataclass
class GoldSnapshotPlan:
    """Snapshot plan generated by GoldSnapshotPlanner."""

    snapshot_id: str
    snapshot_fingerprint: str
    manifest: GoldSnapshotManifest

    def to_dict(self) -> Dict[str, Any]:
        return {
            "snapshot_id": self.snapshot_id,
            "snapshot_fingerprint": self.snapshot_fingerprint,
            "manifest": self.manifest.to_dict(),
        }


class GoldSnapshotPlanner:
    """Planner to construct deterministic Gold snapshot manifests from verified Silver inputs."""

    SUPPORTED_SILVER_SCHEMAS = {
        "silver-lightcurve-v1",
        "silver-target-pixel-v1",
        "silver-ffi-v1",
    }

    def plan_snapshot(
        self,
        snapshot_type: str,
        gold_schema_version: str,
        feature_versions: Dict[str, str],
        inputs: List[SilverInputRef],
        catalog_snapshots: Optional[Dict[str, str]] = None,
        label_snapshots: Optional[Dict[str, str]] = None,
        allow_empty: bool = False,
    ) -> GoldSnapshotPlan:
        """Create a deterministic GoldSnapshotPlan from Silver inputs."""
        snapshot_type = snapshot_type.upper()
        if snapshot_type not in ("CANDIDATE", "ANOMALY"):
            raise ValueError(f"Unsupported snapshot_type: {snapshot_type}")

        if not inputs and not allow_empty:
            raise ValueError(
                "Cannot plan Gold snapshot with 0 Silver inputs (allow_empty=False)"
            )

        # Validate Silver schemas & duplicates
        seen_keys = set()
        processor_versions: Dict[str, str] = {}

        for inp in inputs:
            if inp.silver_schema_version not in self.SUPPORTED_SILVER_SCHEMAS:
                raise ValueError(
                    f"Unsupported Silver schema version: {inp.silver_schema_version}"
                )

            key = (inp.product_kind, inp.source_product_id)
            if key in seen_keys:
                raise ValueError(
                    f"Duplicate Silver input reference detected for: {key}"
                )
            seen_keys.add(key)

            # Check for mixed processor versions within same product kind
            if inp.product_kind in processor_versions:
                if processor_versions[inp.product_kind] != inp.processor_version:
                    raise ValueError(
                        f"Mixed processor versions for {inp.product_kind}: "
                        f"'{processor_versions[inp.product_kind]}' vs '{inp.processor_version}'"
                    )
            else:
                processor_versions[inp.product_kind] = inp.processor_version

        sorted_inputs = sort_silver_inputs(inputs)
        snapshot_id, snapshot_fingerprint = derive_snapshot_identity(
            snapshot_type=snapshot_type,
            gold_schema_version=gold_schema_version,
            feature_versions=feature_versions,
            inputs=sorted_inputs,
            catalog_snapshots=catalog_snapshots,
            label_snapshots=label_snapshots,
        )

        manifest = GoldSnapshotManifest(
            schema_version=1,
            snapshot_id=snapshot_id,
            snapshot_fingerprint=snapshot_fingerprint,
            snapshot_type=snapshot_type,
            gold_schema_version=gold_schema_version,
            feature_versions=feature_versions or {},
            input_count=len(sorted_inputs),
            inputs=sorted_inputs,
            catalog_snapshots=catalog_snapshots or {},
            label_snapshots=label_snapshots or {},
            producer="python-ml-worker",
        )
        manifest.validate()

        return GoldSnapshotPlan(
            snapshot_id=snapshot_id,
            snapshot_fingerprint=snapshot_fingerprint,
            manifest=manifest,
        )
