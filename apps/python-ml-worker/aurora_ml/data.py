"""Data loading & lineage discovery helpers for Gold datasets."""

from typing import Any, Dict, Optional

from aurora_ml.pipeline.gold import SilverInputRef


def parse_lineage_to_silver_ref(
    lineage_data: Dict[str, Any],
    silver_bucket: str = "aurora-silver",
) -> Optional[SilverInputRef]:
    """Parse a committed Lineage JSON dictionary into a verified SilverInputRef.

    Returns None if lineage is not in LINEAGE_COMMITTED status or lacks valid Silver info.
    Note: Lifecycle status RAW_DELETED does NOT invalidate the Silver artifact for Stage 5.
    """
    if lineage_data.get("status") != "LINEAGE_COMMITTED":
        return None

    silver = lineage_data.get("silver")
    source = lineage_data.get("source")
    bronze = lineage_data.get("bronze")
    processing = lineage_data.get("processing")

    if not silver or not source or not bronze:
        return None

    silver_sha256 = silver.get("sha256")
    if not silver_sha256:
        return None

    # Construct sample_id if TIC and Sector exist
    tic_id = bronze.get("tic_id")
    sector = bronze.get("sector")
    sample_id = f"tic:{tic_id}:s:{sector}" if tic_id and sector else None

    return SilverInputRef(
        lineage_id=lineage_data.get("lineage_id", ""),
        source_product_id=source.get("source_product_id", ""),
        product_kind=bronze.get("product_kind", "LIGHT_CURVE"),
        silver_bucket=silver.get("bucket", silver_bucket),
        silver_object_key=silver.get("object_key", ""),
        silver_sha256=silver_sha256,
        silver_schema_version=silver.get("schema_version", ""),
        processor_version=processing.get(
            "processor_version", silver.get("processor_version", "")
        ),
        sample_id=sample_id,
    )


class GoldDatasetLoader:
    """Placeholder loader for Gold Parquet datasets."""

    pass
