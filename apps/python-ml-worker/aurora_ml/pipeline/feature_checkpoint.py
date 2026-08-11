"""Feature Engineering Recovery Checkpoints (checkpoints/feature-engineering/).

Manages snapshot recovery checkpoints for Stage 5 Gold materialization.
"""

from dataclasses import asdict, dataclass, field
from datetime import datetime, timezone
import json
from typing import Any, Dict, List, Optional


class FeatureCheckpointState:
    PLANNED = "PLANNED"
    MATERIALIZING = "MATERIALIZING"
    DATA_STORED = "DATA_STORED"
    COMMITTED = "COMMITTED"
    FAILED = "FAILED"


@dataclass
class FeatureArtifactProgress:
    """Progress record for a single materialized Gold partition artifact."""

    dataset: str
    sector: int
    object_key: str
    row_count: int
    content_sha256: str
    parquet_sha256: str
    size_bytes: int

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "FeatureArtifactProgress":
        return cls(
            dataset=d["dataset"],
            sector=int(d["sector"]),
            object_key=d["object_key"],
            row_count=int(d["row_count"]),
            content_sha256=d["content_sha256"],
            parquet_sha256=d["parquet_sha256"],
            size_bytes=int(d["size_bytes"]),
        )


@dataclass
class FeatureCheckpointRecord:
    """Feature engineering recovery checkpoint record."""

    snapshot_id: str
    snapshot_type: str
    snapshot_fingerprint: str
    expected_artifact_count: int
    schema_version: int = 1
    state: str = FeatureCheckpointState.PLANNED
    artifacts: List[FeatureArtifactProgress] = field(default_factory=list)
    attempts: int = 1
    last_error: Optional[str] = None
    created_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )
    updated_at: str = field(
        default_factory=lambda: datetime.now(timezone.utc).isoformat()
    )

    def to_dict(self) -> Dict[str, Any]:
        return {
            "schema_version": self.schema_version,
            "snapshot_id": self.snapshot_id,
            "snapshot_type": self.snapshot_type,
            "snapshot_fingerprint": self.snapshot_fingerprint,
            "state": self.state,
            "expected_artifact_count": self.expected_artifact_count,
            "artifacts": [art.to_dict() for art in self.artifacts],
            "attempts": self.attempts,
            "last_error": self.last_error,
            "created_at": self.created_at,
            "updated_at": self.updated_at,
        }

    def to_json(self, indent: Optional[int] = 2) -> str:
        return json.dumps(self.to_dict(), indent=indent)

    @classmethod
    def from_dict(cls, d: Dict[str, Any]) -> "FeatureCheckpointRecord":
        if d.get("schema_version") != 1:
            raise ValueError(
                f"Unsupported FeatureCheckpoint schema_version: {d.get('schema_version')}"
            )
        artifacts = [
            FeatureArtifactProgress.from_dict(art) for art in d.get("artifacts", [])
        ]
        return cls(
            schema_version=1,
            snapshot_id=d["snapshot_id"],
            snapshot_type=d["snapshot_type"],
            snapshot_fingerprint=d["snapshot_fingerprint"],
            state=d.get("state", FeatureCheckpointState.PLANNED),
            expected_artifact_count=int(
                d.get("expected_artifact_count", len(artifacts))
            ),
            artifacts=artifacts,
            attempts=int(d.get("attempts", 1)),
            last_error=d.get("last_error"),
            created_at=d.get("created_at", ""),
            updated_at=d.get("updated_at", ""),
        )

    @classmethod
    def from_json(cls, s: str) -> "FeatureCheckpointRecord":
        return cls.from_dict(json.loads(s))


def get_feature_checkpoint_key(snapshot_id: str) -> str:
    """Get canonical MinIO object key for a feature checkpoint."""
    return f"checkpoints/feature-engineering/snapshots/{snapshot_id}.json"
