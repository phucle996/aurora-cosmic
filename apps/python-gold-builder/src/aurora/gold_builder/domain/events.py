"""Silver event contract and conversion to the shared Gold input contract."""

from dataclasses import dataclass, asdict
import hashlib
import re
from typing import Any, Dict, Optional

from aurora_ml.pipeline.gold import SilverInputRef


class SilverEventError(ValueError):
    pass


@dataclass(frozen=True)
class SilverEvent:
    event_id: str
    event_type: str
    source_event_id: str
    source_product_id: str
    sample_id: Optional[str]
    bucket: str
    object_key: str
    product_kind: str
    schema_version: str
    processor_version: str
    processing_fingerprint: str
    sector: int
    tic_id: Optional[int]
    camera: Optional[int]
    ccd: Optional[int]
    size_bytes: int
    sha256: str
    occurred_at: str

    @classmethod
    def from_dict(cls, payload: Dict[str, Any]) -> "SilverEvent":
        required = (
            "event_id",
            "source_product_id",
            "bucket",
            "object_key",
            "product_kind",
            "schema_version",
            "processor_version",
            "sector",
            "size_bytes",
            "sha256",
        )
        missing = [key for key in required if key not in payload]
        if missing:
            raise SilverEventError(f"Silver event missing fields: {', '.join(missing)}")
        product_kind = str(payload["product_kind"]).upper()
        if product_kind not in {"LIGHT_CURVE", "TARGET_PIXEL"}:
            raise SilverEventError(f"Unsupported Silver product_kind: {product_kind}")
        if (
            str(payload.get("event_type", "silver.object.ready"))
            != "silver.object.ready"
        ):
            raise SilverEventError("Unsupported Silver event_type")
        sha256 = str(payload["sha256"]).lower()
        if not re.fullmatch(r"[0-9a-f]{64}", sha256):
            raise SilverEventError(
                "Silver event sha256 must be a 64-character hex digest"
            )
        sector = int(payload["sector"])
        size_bytes = int(payload["size_bytes"])
        if sector <= 0:
            raise SilverEventError("Silver event sector must be positive")
        if size_bytes < 0:
            raise SilverEventError("Silver event size_bytes cannot be negative")
        return cls(
            event_id=str(payload["event_id"]),
            event_type="silver.object.ready",
            source_event_id=str(payload.get("source_event_id", "")),
            source_product_id=str(payload["source_product_id"]),
            sample_id=payload.get("sample_id"),
            bucket=str(payload["bucket"]),
            object_key=str(payload["object_key"]),
            product_kind=product_kind,
            schema_version=str(payload["schema_version"]),
            processor_version=str(payload["processor_version"]),
            processing_fingerprint=str(payload.get("processing_fingerprint", "")),
            sector=sector,
            tic_id=(
                int(payload["tic_id"]) if payload.get("tic_id") is not None else None
            ),
            camera=(
                int(payload["camera"]) if payload.get("camera") is not None else None
            ),
            ccd=int(payload["ccd"]) if payload.get("ccd") is not None else None,
            size_bytes=size_bytes,
            sha256=sha256,
            occurred_at=str(payload.get("occurred_at", "")),
        )

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)

    @property
    def lineage_id(self) -> str:
        """Logical lineage identifier retained for existing provenance records."""
        canonical = f"{self.source_product_id}:{self.processor_version}"
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @property
    def revision_id(self) -> str:
        """Identity of the exact Silver artifact consumed by a Gold snapshot."""
        canonical = ":".join(
            (
                self.source_product_id,
                self.processor_version,
                self.processing_fingerprint,
                self.sha256,
            )
        )
        return hashlib.sha256(canonical.encode("utf-8")).hexdigest()

    @property
    def effective_sample_id(self) -> Optional[str]:
        if self.sample_id:
            return self.sample_id
        if self.tic_id is not None:
            return f"tic:{self.tic_id}:s:{self.sector}"
        return None

    def to_input_ref(self) -> SilverInputRef:
        return SilverInputRef(
            lineage_id=self.lineage_id,
            source_product_id=self.source_product_id,
            product_kind=self.product_kind,
            silver_bucket=self.bucket,
            silver_object_key=self.object_key,
            silver_sha256=self.sha256,
            silver_schema_version=self.schema_version,
            processor_version=self.processor_version,
            sample_id=self.effective_sample_id,
            processing_fingerprint=self.processing_fingerprint,
            silver_revision_id=self.revision_id,
        )
