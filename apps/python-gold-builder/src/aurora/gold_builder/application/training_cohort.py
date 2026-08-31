"""Deterministic auto-labelling for the supervised training cohort.

Candidate Gold remains immutable discovery evidence.  This module derives a
separate, reviewable cohort; no label is ever written back into Gold.
"""

from __future__ import annotations

from dataclasses import dataclass
import json
from typing import Any


COHORT_POLICY_VERSION = "candidate-auto-label-v1"


@dataclass(frozen=True)
class CohortLabel:
    label: str
    confidence: float
    source: str
    train_eligible: bool
    evidence: dict[str, Any]


def auto_label_candidate(row: dict[str, Any]) -> CohortLabel:
    """Return a conservative label derived only from catalogued evidence.

    A TOI ephemeris match plus pixel-level transit evidence is a strong
    positive.  A missing TOI alone is *not* a negative: it needs a clean TPF
    veto as well.  Everything else remains unresolved for optional review.
    """
    toi_status = str(row.get("toi_match_status") or "CATALOG_UNAVAILABLE")
    transit = bool(row.get("transit_evidence_available"))
    bls_available = bool(row.get("bls_available"))
    bls_power = row.get("bls_power")
    evidence = {
        "toi_match_status": toi_status,
        "transit_evidence_available": transit,
        "bls_available": bls_available,
        "bls_power": bls_power,
    }
    if toi_status == "EPHEMERIS_MATCH" and transit:
        return CohortLabel("POSITIVE", 0.99, "AUTO_TOI_EPHEMERIS_TPF", True, evidence)
    if toi_status == "NO_TOI_FOR_TARGET" and bls_available and not transit:
        return CohortLabel("NEGATIVE", 0.90, "AUTO_TPF_VETO", True, evidence)
    return CohortLabel("UNRESOLVED", 0.0, "AUTO_INSUFFICIENT_EVIDENCE", False, evidence)


def label_rows(snapshot_id: str, rows: list[dict[str, Any]]) -> list[dict[str, Any]]:
    labels: list[dict[str, Any]] = []
    for row in rows:
        source_product_id = str(row.get("source_product_id") or "")
        tic_id, sector = row.get("tic_id"), row.get("sector")
        if not source_product_id or tic_id is None or sector is None:
            continue
        label = auto_label_candidate(row)
        labels.append(
            {
                "snapshot_id": snapshot_id,
                "source_product_id": source_product_id,
                "tic_id": int(tic_id),
                "sector": int(sector),
                "training_label": label.label,
                "confidence": label.confidence,
                "label_source": label.source,
                "review_status": "AUTO_ACCEPTED" if label.train_eligible else "UNRESOLVED",
                "train_eligible": label.train_eligible,
                "policy_version": COHORT_POLICY_VERSION,
                "evidence_json": json.dumps(label.evidence, sort_keys=True),
            }
        )
    return labels
