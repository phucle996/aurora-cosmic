"""Astronomical Catalog Snapshot, Ephemeris Candidate Matching & Label Versioning (Phase 5.4).

Manages immutable TIC/TOI/TCE catalog snapshots, candidate ephemeris matching (toi-match-v2),
and conservative training label derivation (candidate-label-policy-v1).
"""

from dataclasses import asdict, dataclass
import hashlib
import json
import math
from typing import Any, Dict, List, Optional, Tuple


from aurora_ml.pipeline.evidence import TpfVettingFeatures
from aurora_ml.pipeline.features import LightCurveFeatures

# Strict Leakage Prevention Allowlists
MODEL_INPUT_ALLOWLIST = {
    # Stellar Context
    "ra_deg",
    "dec_deg",
    "tmag",
    "teff",
    "stellar_radius",
    "stellar_mass",
    "logg",
    # Light Curve Signal Features
    "n_points",
    "time_span",
    "median_cadence",
    "max_gap",
    "flux_mean",
    "flux_median",
    "flux_std",
    "flux_mad",
    "flux_robust_sigma",
    "flux_amplitude",
    "flux_rms",
    "flux_skewness",
    "flux_kurtosis",
    "median_flux_err",
    "mean_flux_err",
    "bls_available",
    "bls_period",
    "bls_duration",
    "bls_transit_time",
    "bls_depth",
    "bls_power",
    # TPF Vetting Features
    "pixel_mad_median",
    "pixel_mad_mean",
    "pixel_mad_max",
    "variability_peak_fraction",
    "variability_effective_pixels",
    "summed_flux_std",
    "summed_flux_mad",
    "summed_flux_p05",
    "summed_flux_p95",
    "transit_evidence_available",
    "transit_deficit_sum",
    "transit_deficit_peak_fraction",
    "transit_deficit_effective_pixels",
    "transit_deficit_centroid_row",
    "transit_deficit_centroid_col",
    "transit_deficit_center_offset_pixels",
}

SUPERVISION_ALLOWLIST = {
    "training_label",
    "toi_disposition_raw",
    "toi_disposition_norm",
    "matched_toi_id",
    "toi_match_status",
    "matched_tce_id",
    "tce_match_status",
    "label_policy_version",
}


@dataclass
class CatalogSnapshotManifest:
    """Immutable catalog snapshot manifest conforming to catalog-snapshot-v1.md."""

    schema_version: str
    catalog_type: str
    snapshot_id: str
    snapshot_fingerprint: str
    normalization_version: str
    provider: str
    source_uri: str
    source_query: str
    retrieved_at: str
    row_count: int
    data_object_key: str
    data_sha256: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TicCatalogRecord:
    """Normalized TIC target record conforming to catalog-tic-v1.md."""

    tic_id: int
    ra_deg: Optional[float] = None
    dec_deg: Optional[float] = None
    tmag: Optional[float] = None
    teff: Optional[float] = None
    stellar_radius: Optional[float] = None
    stellar_mass: Optional[float] = None
    logg: Optional[float] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class ToiCatalogRecord:
    """Normalized TOI candidate record conforming to catalog-toi-v1.md."""

    toi_id: str
    tic_id: int
    catalog_period: Optional[float] = None
    catalog_epoch: Optional[float] = None
    catalog_duration: Optional[float] = None
    catalog_depth: Optional[float] = None
    toi_disposition_raw: str = "UNKNOWN"
    toi_disposition_norm: str = "UNKNOWN"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class TceCatalogRecord:
    """Normalized TCE pipeline detection record conforming to catalog-tce-v1.md."""

    tce_id: str
    tic_id: int
    sector: Optional[int] = None
    catalog_period: Optional[float] = None
    catalog_epoch: Optional[float] = None
    catalog_duration: Optional[float] = None
    detection_statistic: Optional[float] = None
    tce_disposition_raw: str = "UNKNOWN"

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CandidateLabelRecord:
    """Versioned candidate training label record conforming to candidate-label-v1.md."""

    source_product_id: str
    toi_match_status: str
    tce_match_status: str
    training_label: str
    label_policy_version: str = "candidate-label-policy-v1"
    sample_id: Optional[str] = None
    tic_id: Optional[int] = None
    matched_toi_id: Optional[str] = None
    matched_tce_id: Optional[str] = None
    toi_snapshot_id: Optional[str] = None
    tce_snapshot_id: Optional[str] = None

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


@dataclass
class CandidateEnrichmentRecord:
    """Enriched candidate record merging signal features, catalog context, and labels."""

    # Identity & Provenance
    source_product_id: str
    sample_id: Optional[str]
    tic_id: Optional[int]

    # Provenance Snapshots
    lc_feature_fingerprint: str
    tic_snapshot_id: Optional[str]
    toi_snapshot_id: Optional[str]
    tce_snapshot_id: Optional[str]
    label_policy_version: str

    # TIC Stellar Context
    tic_available: bool
    tmag: Optional[float]
    teff: Optional[float]
    stellar_radius: Optional[float]
    stellar_mass: Optional[float]
    logg: Optional[float]

    # TOI Candidate Context & Ephemeris Match
    target_has_toi: bool
    toi_count_for_target: int
    matched_toi_id: Optional[str]
    toi_match_status: str
    toi_period_error: Optional[float]
    toi_disposition_norm: Optional[str]

    # TCE Pipeline Context
    matched_tce_id: Optional[str]
    tce_match_status: str
    tce_detection_statistic: Optional[float]

    # Derived Training Supervision Label
    training_label: str
    enrichment_status: str

    def to_dict(self) -> Dict[str, Any]:
        return asdict(self)


def derive_catalog_snapshot_identity(
    catalog_type: str,
    normalization_version: str,
    data_sha256: str,
) -> str:
    """Compute deterministic catalog snapshot identity from canonical content digest."""
    cat_type = catalog_type.upper().strip()
    norm_ver = normalization_version.lower().strip()
    content_hash = hashlib.sha256(
        f"{cat_type}:{norm_ver}:{data_sha256}".encode("utf-8")
    ).hexdigest()
    return f"{cat_type.lower()}-v1-{content_hash[:12]}"


def derive_label_snapshot_identity(
    label_policy_version: str,
    toi_snapshot_id: Optional[str],
    tce_snapshot_id: Optional[str],
    data_sha256: str,
) -> str:
    """Compute deterministic label snapshot identity."""
    canonical_str = f"{label_policy_version}:{toi_snapshot_id or 'none'}:{tce_snapshot_id or 'none'}:{data_sha256}"
    content_hash = hashlib.sha256(canonical_str.encode("utf-8")).hexdigest()
    return f"label-v1-{content_hash[:12]}"


def parse_nullable_float(val: Any) -> Optional[float]:
    if val is None:
        return None
    s = str(val).strip()
    if s == "" or s.lower() in ("n/a", "--", "null", "none", "nan"):
        return None
    try:
        f = float(s)
        return f if math.isfinite(f) else None
    except ValueError:
        return None


def parse_nullable_int(val: Any) -> Optional[int]:
    f = parse_nullable_float(val)
    return int(f) if f is not None else None


def normalize_toi_disposition(raw_disposition: str) -> str:
    raw = str(raw_disposition).strip().upper()
    if "CONFIRMED" in raw or "KNOWN PLANET" in raw or "KP" in raw or raw == "CP":
        return "KNOWN_PLANET"
    elif "FALSE POSITIVE" in raw or "FP" in raw or "FA" in raw:
        return "FALSE_POSITIVE"
    elif "CANDIDATE" in raw or "PC" in raw or "TOI" in raw:
        return "CANDIDATE"
    elif "AMBIGUOUS" in raw:
        return "AMBIGUOUS"
    elif raw in ("", "UNKNOWN", "NONE", "N/A"):
        return "UNKNOWN"
    return "OTHER"


def normalize_tic_catalog(
    rows: List[Dict[str, Any]],
) -> Tuple[List[TicCatalogRecord], str]:
    """Normalize raw TIC rows with canonical sorting and duplicate key rejection."""
    records: Dict[int, TicCatalogRecord] = {}

    for row in rows:
        tic_id = parse_nullable_int(row.get("tic_id"))
        if tic_id is None:
            raise ValueError("TIC catalog row missing required integer 'tic_id'")
        if tic_id in records:
            raise ValueError(
                f"CATALOG_DUPLICATE_KEY: Duplicate tic_id {tic_id} found in TIC snapshot"
            )

        rec = TicCatalogRecord(
            tic_id=tic_id,
            ra_deg=parse_nullable_float(row.get("ra_deg") or row.get("ra")),
            dec_deg=parse_nullable_float(row.get("dec_deg") or row.get("dec")),
            tmag=parse_nullable_float(row.get("tmag")),
            teff=parse_nullable_float(row.get("teff")),
            stellar_radius=parse_nullable_float(
                row.get("stellar_radius") or row.get("rad")
            ),
            stellar_mass=parse_nullable_float(
                row.get("stellar_mass") or row.get("mass")
            ),
            logg=parse_nullable_float(row.get("logg")),
        )
        records[tic_id] = rec

    sorted_records = [records[k] for k in sorted(records.keys())]

    # Compute data_sha256 digest over canonical JSON representation
    canonical_data = [rec.to_dict() for rec in sorted_records]
    canonical_json = json.dumps(canonical_data, sort_keys=True, separators=(",", ":"))
    data_sha256 = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    return sorted_records, data_sha256


def normalize_toi_catalog(
    rows: List[Dict[str, Any]],
) -> Tuple[List[ToiCatalogRecord], str]:
    """Normalize raw TOI rows with string ID preservation and canonical sorting."""
    records: List[ToiCatalogRecord] = []

    for row in rows:
        toi_id = str(row.get("toi_id", "")).strip()
        tic_id = parse_nullable_int(row.get("tic_id"))

        if not toi_id or tic_id is None:
            raise ValueError("TOI catalog row missing required 'toi_id' or 'tic_id'")

        raw_disp = str(
            row.get("toi_disposition_raw") or row.get("tfopwg_disp") or "UNKNOWN"
        ).strip()
        norm_disp = normalize_toi_disposition(raw_disp)

        rec = ToiCatalogRecord(
            toi_id=toi_id,
            tic_id=tic_id,
            catalog_period=parse_nullable_float(
                row.get("catalog_period") or row.get("period")
            ),
            catalog_epoch=parse_nullable_float(
                row.get("catalog_epoch") or row.get("epoch")
            ),
            catalog_duration=parse_nullable_float(
                row.get("catalog_duration") or row.get("duration")
            ),
            catalog_depth=parse_nullable_float(
                row.get("catalog_depth") or row.get("depth")
            ),
            toi_disposition_raw=raw_disp,
            toi_disposition_norm=norm_disp,
        )
        records.append(rec)

    # Sort canonically by (tic_id, toi_id)
    sorted_records = sorted(records, key=lambda r: (r.tic_id, r.toi_id))

    canonical_data = [rec.to_dict() for rec in sorted_records]
    canonical_json = json.dumps(canonical_data, sort_keys=True, separators=(",", ":"))
    data_sha256 = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    return sorted_records, data_sha256


def normalize_tce_catalog(
    rows: List[Dict[str, Any]],
) -> Tuple[List[TceCatalogRecord], str]:
    """Normalize raw TCE rows with canonical sorting."""
    records: List[TceCatalogRecord] = []

    for row in rows:
        tce_id = str(row.get("tce_id", "")).strip()
        tic_id = parse_nullable_int(row.get("tic_id"))

        if not tce_id or tic_id is None:
            raise ValueError("TCE catalog row missing required 'tce_id' or 'tic_id'")

        rec = TceCatalogRecord(
            tce_id=tce_id,
            tic_id=tic_id,
            sector=parse_nullable_int(row.get("sector")),
            catalog_period=parse_nullable_float(
                row.get("catalog_period") or row.get("period")
            ),
            catalog_epoch=parse_nullable_float(
                row.get("catalog_epoch") or row.get("epoch")
            ),
            catalog_duration=parse_nullable_float(
                row.get("catalog_duration") or row.get("duration")
            ),
            detection_statistic=parse_nullable_float(
                row.get("detection_statistic") or row.get("max_mes")
            ),
            tce_disposition_raw=str(
                row.get("tce_disposition_raw") or "UNKNOWN"
            ).strip(),
        )
        records.append(rec)

    sorted_records = sorted(records, key=lambda r: (r.tic_id, r.tce_id))

    canonical_data = [rec.to_dict() for rec in sorted_records]
    canonical_json = json.dumps(canonical_data, sort_keys=True, separators=(",", ":"))
    data_sha256 = hashlib.sha256(canonical_json.encode("utf-8")).hexdigest()

    return sorted_records, data_sha256


def match_toi_candidate(
    lc_features: LightCurveFeatures,
    toi_candidates: List[ToiCatalogRecord],
    period_tolerance: float = 0.05,
) -> Tuple[Optional[ToiCatalogRecord], str, Optional[float]]:
    """Match detected BLS candidate against TOI entries for the target TIC ID.

    Returns (matched_toi_record, match_status, period_error).
    """
    if lc_features.tic_id is None:
        return None, "TARGET_ID_UNAVAILABLE", None
    if not lc_features.bls_available or lc_features.bls_period is None:
        return None, "BLS_UNAVAILABLE", None

    tic_id = lc_features.tic_id
    bls_period = lc_features.bls_period

    # Filter TOIs for target TIC
    target_tois = [r for r in toi_candidates if r.tic_id == tic_id]
    if not target_tois:
        return None, "NO_TOI_FOR_TARGET", None

    exact_matches: List[Tuple[ToiCatalogRecord, float]] = []
    harmonic_matches: List[Tuple[ToiCatalogRecord, float]] = []

    for toi in target_tois:
        if toi.catalog_period is None or toi.catalog_period <= 0:
            continue

        cat_period = toi.catalog_period

        # 1. Check exact match (h = 1.0)
        rel_err_exact = abs(bls_period - cat_period) / cat_period
        if rel_err_exact <= period_tolerance:
            exact_matches.append((toi, rel_err_exact))
            continue

        # 2. Check simple harmonics (h = 0.5, 2.0)
        for h in (0.5, 2.0):
            eff_period = cat_period * h
            rel_err_h = abs(bls_period - eff_period) / eff_period
            if rel_err_h <= period_tolerance:
                harmonic_matches.append((toi, rel_err_h))

    # Exact matches take priority over harmonic matches
    if len(exact_matches) == 1:
        best_toi, best_err = exact_matches[0]
        status = (
            "EPHEMERIS_MATCH"
            if (
                best_toi.catalog_epoch is not None
                and lc_features.bls_transit_time is not None
            )
            else "PERIOD_ONLY"
        )
        return best_toi, status, best_err
    elif len(exact_matches) > 1:
        return None, "AMBIGUOUS", None

    # Fallback to harmonic matches if no exact match exists
    if len(harmonic_matches) == 1:
        best_toi, best_err = harmonic_matches[0]
        status = (
            "EPHEMERIS_MATCH"
            if (
                best_toi.catalog_epoch is not None
                and lc_features.bls_transit_time is not None
            )
            else "PERIOD_ONLY"
        )
        return best_toi, status, best_err
    elif len(harmonic_matches) > 1:
        return None, "AMBIGUOUS", None

    # The catalog has one or more TOIs for this TIC, but the measured BLS
    # period does not agree with an exact or supported harmonic.  This is
    # materially different from a target that is absent from the TOI catalog.
    return None, "PERIOD_MISMATCH", None


def match_tce_candidate(
    lc_features: LightCurveFeatures,
    tce_candidates: List[TceCatalogRecord],
    period_tolerance: float = 0.05,
) -> Tuple[Optional[TceCatalogRecord], str]:
    """Match detected BLS candidate against TCE entries for target TIC ID and sector."""
    if (
        lc_features.tic_id is None
        or not lc_features.bls_available
        or lc_features.bls_period is None
    ):
        return None, "NO_MATCH"

    tic_id = lc_features.tic_id
    sector = lc_features.sector
    bls_period = lc_features.bls_period

    target_tces = [
        r
        for r in tce_candidates
        if r.tic_id == tic_id
        and (sector is None or r.sector is None or r.sector == sector)
    ]
    if not target_tces:
        return None, "NO_MATCH"

    best_match: Optional[TceCatalogRecord] = None
    best_error: float = float("inf")
    matched_count = 0

    for tce in target_tces:
        if tce.catalog_period is None or tce.catalog_period <= 0:
            continue
        rel_err = abs(bls_period - tce.catalog_period) / tce.catalog_period
        if rel_err <= period_tolerance:
            if rel_err < best_error - 1e-6:
                best_error = rel_err
                best_match = tce
                matched_count = 1
            elif abs(rel_err - best_error) <= 1e-6 and tce != best_match:
                matched_count += 1

    if matched_count > 1:
        return None, "AMBIGUOUS"
    elif best_match is not None:
        return best_match, "PERIOD_ONLY"

    return None, "NO_MATCH"


def derive_candidate_label(
    toi_match_result: Tuple[Optional[ToiCatalogRecord], str, Optional[float]],
    tce_match_result: Tuple[Optional[TceCatalogRecord], str],
    policy_version: str = "candidate-label-policy-v1",
) -> CandidateLabelRecord:
    """Derive conservative ML training label from matched TOI/TCE catalog state under candidate-label-policy-v1."""
    toi_rec, toi_status, _ = toi_match_result
    tce_rec, tce_status = tce_match_result

    training_label = "UNRESOLVED"

    if toi_rec is not None and toi_status in ("EPHEMERIS_MATCH", "PERIOD_ONLY"):
        if toi_rec.toi_disposition_norm == "KNOWN_PLANET":
            training_label = "POSITIVE"
        elif toi_rec.toi_disposition_norm == "FALSE_POSITIVE":
            training_label = "NEGATIVE"
        else:
            training_label = "UNRESOLVED"

    return CandidateLabelRecord(
        source_product_id=toi_rec.toi_id
        if toi_rec
        else (tce_rec.tce_id if tce_rec else "unknown"),
        sample_id=None,
        tic_id=toi_rec.tic_id if toi_rec else (tce_rec.tic_id if tce_rec else None),
        matched_toi_id=toi_rec.toi_id if toi_rec else None,
        toi_match_status=toi_status,
        matched_tce_id=tce_rec.tce_id if tce_rec else None,
        tce_match_status=tce_status,
        training_label=training_label,
        label_policy_version=policy_version,
    )


def enrich_candidate(
    lc_features: LightCurveFeatures,
    tpf_features: Optional[TpfVettingFeatures],
    tic_index: Dict[int, TicCatalogRecord],
    toi_candidates: List[ToiCatalogRecord],
    tce_candidates: List[TceCatalogRecord],
    tic_snapshot_id: Optional[str] = None,
    toi_snapshot_id: Optional[str] = None,
    tce_snapshot_id: Optional[str] = None,
    period_tolerance: float = 0.05,
    policy_version: str = "candidate-label-policy-v1",
) -> Tuple[CandidateEnrichmentRecord, CandidateLabelRecord]:
    """Enrich candidate with astronomical catalog context and conservative training label.

    INVARIANT: Signal features (lc_features, tpf_features) are NEVER mutated!
    """
    tic_id = lc_features.tic_id
    tic_rec = tic_index.get(tic_id) if tic_id is not None else None
    tic_available = tic_rec is not None

    # Target-level TOI count
    target_tois = (
        [r for r in toi_candidates if r.tic_id == tic_id] if tic_id is not None else []
    )
    target_has_toi = len(target_tois) > 0
    toi_count_for_target = len(target_tois)

    # Candidate ephemeris matching
    toi_match = match_toi_candidate(
        lc_features, toi_candidates, period_tolerance=period_tolerance
    )
    tce_match = match_tce_candidate(
        lc_features, tce_candidates, period_tolerance=period_tolerance
    )

    toi_rec, toi_status, toi_p_err = toi_match
    tce_rec, tce_status = tce_match

    # Derive training label record
    label_rec = derive_candidate_label(
        toi_match, tce_match, policy_version=policy_version
    )
    label_rec.source_product_id = lc_features.source_product_id
    label_rec.sample_id = lc_features.sample_id
    label_rec.tic_id = tic_id
    label_rec.toi_snapshot_id = toi_snapshot_id
    label_rec.tce_snapshot_id = tce_snapshot_id

    enrichment_status = "SUCCESS" if tic_available else "PARTIAL"

    enrichment_rec = CandidateEnrichmentRecord(
        source_product_id=lc_features.source_product_id,
        sample_id=lc_features.sample_id,
        tic_id=tic_id,
        lc_feature_fingerprint=lc_features.feature_fingerprint,
        tic_snapshot_id=tic_snapshot_id,
        toi_snapshot_id=toi_snapshot_id,
        tce_snapshot_id=tce_snapshot_id,
        label_policy_version=policy_version,
        tic_available=tic_available,
        tmag=tic_rec.tmag if tic_rec else None,
        teff=tic_rec.teff if tic_rec else None,
        stellar_radius=tic_rec.stellar_radius if tic_rec else None,
        stellar_mass=tic_rec.stellar_mass if tic_rec else None,
        logg=tic_rec.logg if tic_rec else None,
        target_has_toi=target_has_toi,
        toi_count_for_target=toi_count_for_target,
        matched_toi_id=toi_rec.toi_id if toi_rec else None,
        toi_match_status=toi_status,
        toi_period_error=toi_p_err,
        toi_disposition_norm=toi_rec.toi_disposition_norm if toi_rec else None,
        matched_tce_id=tce_rec.tce_id if tce_rec else None,
        tce_match_status=tce_status,
        tce_detection_statistic=tce_rec.detection_statistic if tce_rec else None,
        training_label=label_rec.training_label,
        enrichment_status=enrichment_status,
    )

    return enrichment_rec, label_rec
