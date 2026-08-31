"""Immutable catalog snapshots used for Gold enrichment and auto-labeling.

Gold retrieves only the TIC and TOI rows required by a ready batch, stores the
normalized response as an immutable MinIO snapshot, and pins that snapshot in
the resulting Gold manifest.  A failed provider request therefore blocks the
batch for retry; it can never produce a partially enriched training artifact.
"""

from __future__ import annotations

import csv
from dataclasses import dataclass, field
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import time
from typing import Any, Iterable, Sequence
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

from aurora_ml.pipeline.catalogs import (
    CatalogSnapshotManifest,
    TceCatalogRecord,
    TicCatalogRecord,
    ToiCatalogRecord,
    derive_catalog_snapshot_identity,
    normalize_tce_catalog,
    normalize_tic_catalog,
    normalize_toi_catalog,
)

from ..infrastructure.object_store import ObjectStore


CATALOG_SPECS = {
    "TIC": ("tic-normalize-v1", normalize_tic_catalog, TicCatalogRecord),
    "TOI": ("toi-normalize-v1", normalize_toi_catalog, ToiCatalogRecord),
    "TCE": ("tce-normalize-v1", normalize_tce_catalog, TceCatalogRecord),
}

NASA_EXOPLANET_ARCHIVE_TAP = "https://exoplanetarchive.ipac.caltech.edu/TAP/sync"
NASA_TOI_QUERY = (
    "select tid as tic_id, toi as toi_id, pl_orbper as period, "
    "pl_tranmid as epoch, pl_trandurh as duration, pl_trandep as depth, "
    "tfopwg_disp from toi"
)
MAST_INVOKE_URL = "https://mast.stsci.edu/api/v0/invoke"
ON_DEMAND_CACHE_PREFIX = "catalogs/on-demand/"
CATALOG_SYNC_VERSION = "catalog-sync-v1"
TIC_REQUEST_SIZE = 100
TOI_REQUEST_SIZE = 250
CATALOG_REQUEST_ATTEMPTS = 3


class CatalogSnapshotError(RuntimeError):
    """A configured catalog snapshot is absent, malformed, or changed."""


class CatalogSyncError(RuntimeError):
    """An on-demand catalog retrieval could not produce verified evidence."""


@dataclass(frozen=True)
class CatalogSyncResult:
    """Verified, batch-scoped catalog evidence consumed by one Gold build."""

    catalogs: "CatalogBundle"
    target_count: int
    tic_records: int
    toi_records: int
    cache_hit: bool


def _sha256(data: bytes) -> str:
    return hashlib.sha256(data).hexdigest()


def _canonical_json(value: Any) -> bytes:
    return json.dumps(value, sort_keys=True, separators=(",", ":")).encode("utf-8")


@dataclass(frozen=True)
class CatalogBundle:
    """The exact catalog state selected for a single Gold build."""

    tic_records: list[TicCatalogRecord] = field(default_factory=list)
    toi_records: list[ToiCatalogRecord] = field(default_factory=list)
    tce_records: list[TceCatalogRecord] = field(default_factory=list)
    snapshot_ids: dict[str, str] = field(default_factory=dict)

    @property
    def tic_index(self) -> dict[int, TicCatalogRecord]:
        return {record.tic_id: record for record in self.tic_records}

    @property
    def availability(self) -> str:
        required = {"TIC", "TOI"}
        available = set(self.snapshot_ids)
        if not available:
            return "UNAVAILABLE"
        if required.issubset(available):
            return "COMPLETE"
        return "PARTIAL"

    def has(self, kind: str) -> bool:
        return kind.upper() in self.snapshot_ids


def _snapshot_keys(kind: str, snapshot_id: str) -> tuple[str, str]:
    root = f"catalogs/snapshots/{kind.lower()}/{snapshot_id}"
    return f"{root}/manifest.json", f"{root}/records.json"


def _target_scope(tic_ids: Sequence[int]) -> str:
    """Canonical, bounded identity for the exact targets requested by a batch."""
    normalized = sorted({int(tic_id) for tic_id in tic_ids if int(tic_id) > 0})
    if not normalized:
        raise CatalogSyncError("Gold catalog sync requires at least one TIC ID")
    return f"{CATALOG_SYNC_VERSION}:" + ",".join(map(str, normalized))


def _cache_key(kind: str, scope: str) -> str:
    digest = _sha256(scope.encode())
    return f"{ON_DEMAND_CACHE_PREFIX}{kind.lower()}/{digest}.json"


def _chunked(values: Sequence[int], size: int) -> Iterable[list[int]]:
    for index in range(0, len(values), size):
        yield list(values[index : index + size])


def _require_kind(kind: str) -> str:
    normalized = kind.upper().strip()
    if normalized not in CATALOG_SPECS:
        raise ValueError(
            f"Unsupported catalog kind '{kind}'; expected TIC, TOI, or TCE"
        )
    return normalized


def import_catalog_rows(
    store: ObjectStore,
    bucket: str,
    kind: str,
    raw_rows: Iterable[dict[str, Any]],
    *,
    provider: str,
    source_uri: str,
    source_query: str = "",
    set_current: bool = True,
    identity_scope: str = "",
) -> CatalogSnapshotManifest:
    """Normalize rows, write an immutable snapshot, then atomically select it.

    Re-importing identical canonical content is idempotent.  A different
    payload can never overwrite an existing snapshot ID because its digest is
    part of that ID.
    """

    kind = _require_kind(kind)
    normalization_version, normalizer, _ = CATALOG_SPECS[kind]
    records, data_sha256 = normalizer(list(raw_rows))
    # A target-scoped response with no TOI matches must still retain the exact
    # query scope.  Otherwise every empty response would collapse into one
    # snapshot whose provenance belongs to an unrelated batch.
    identity_digest = data_sha256
    if identity_scope:
        identity_digest = _sha256(f"{data_sha256}:{identity_scope}".encode())
    snapshot_id = derive_catalog_snapshot_identity(
        kind, normalization_version, identity_digest
    )
    manifest_key, records_key = _snapshot_keys(kind, snapshot_id)
    record_payload = [record.to_dict() for record in records]
    records_bytes = _canonical_json(record_payload)
    if _sha256(records_bytes) != data_sha256:
        raise CatalogSnapshotError(
            f"Canonical {kind} serialization checksum differs from normalizer output"
        )

    existing = store.get_json(bucket, manifest_key)
    if existing is not None:
        if existing.get("data_sha256") != data_sha256:
            raise CatalogSnapshotError(f"Immutable catalog conflict at {manifest_key}")
    else:
        store.put_bytes(bucket, records_key, records_bytes, "application/json")
        manifest = CatalogSnapshotManifest(
            schema_version="catalog-snapshot-v1",
            catalog_type=kind,
            snapshot_id=snapshot_id,
            snapshot_fingerprint=data_sha256,
            normalization_version=normalization_version,
            provider=provider,
            source_uri=source_uri,
            source_query=source_query,
            retrieved_at=datetime.now(timezone.utc).isoformat(),
            row_count=len(record_payload),
            data_object_key=records_key,
            data_sha256=data_sha256,
        )
        store.put_json(bucket, manifest_key, manifest.to_dict())
        existing = manifest.to_dict()

    if set_current:
        store.put_json(
            bucket,
            f"catalogs/current/{kind.lower()}.json",
            {
                "schema_version": "catalog-pointer-v1",
                "catalog_type": kind,
                "snapshot_id": snapshot_id,
                "manifest_key": manifest_key,
                "manifest_sha256": _sha256(_canonical_json(existing)),
            },
        )
    return CatalogSnapshotManifest(**existing)


def load_catalog_snapshot(
    store: ObjectStore, bucket: str, kind: str, snapshot_id: str
) -> tuple[str, list[Any]]:
    """Load one immutable snapshot by ID and validate its content checksum."""
    kind = _require_kind(kind)
    snapshot_id = str(snapshot_id).strip()
    if not snapshot_id:
        raise CatalogSnapshotError(f"Missing {kind} catalog snapshot ID")
    manifest_key, _ = _snapshot_keys(kind, snapshot_id)
    manifest = store.get_json(bucket, manifest_key)
    if not manifest:
        raise CatalogSnapshotError(f"Catalog manifest is missing: {manifest_key}")
    if manifest.get("catalog_type") != kind:
        raise CatalogSnapshotError(f"Catalog manifest type mismatch: {manifest_key}")
    if manifest.get("snapshot_id") != snapshot_id:
        raise CatalogSnapshotError(f"Catalog snapshot ID mismatch at {manifest_key}")

    records_key = str(manifest.get("data_object_key") or "")
    records_bytes = store.get_bytes(bucket, records_key)
    if _sha256(records_bytes) != manifest.get("data_sha256"):
        raise CatalogSnapshotError(f"Catalog records checksum mismatch: {records_key}")
    try:
        payload = json.loads(records_bytes)
    except json.JSONDecodeError as exc:
        raise CatalogSnapshotError(
            f"Catalog records are not JSON: {records_key}"
        ) from exc
    if not isinstance(payload, list):
        raise CatalogSnapshotError(f"Catalog records are not a list: {records_key}")

    _, _, record_type = CATALOG_SPECS[kind]
    try:
        records = [record_type(**row) for row in payload]
    except (TypeError, ValueError) as exc:
        raise CatalogSnapshotError(
            f"Invalid normalized records in {records_key}"
        ) from exc
    if len(records) != int(manifest.get("row_count", -1)):
        raise CatalogSnapshotError(f"Catalog row count mismatch: {records_key}")
    return str(manifest["snapshot_id"]), records


def _load_kind(
    store: ObjectStore, bucket: str, kind: str
) -> tuple[str, list[Any]] | None:
    pointer_key = f"catalogs/current/{kind.lower()}.json"
    pointer = store.get_json(bucket, pointer_key)
    if pointer is None:
        return None
    if pointer.get("schema_version") != "catalog-pointer-v1":
        raise CatalogSnapshotError(f"Unsupported catalog pointer at {pointer_key}")
    if str(pointer.get("catalog_type", "")).upper() != kind:
        raise CatalogSnapshotError(f"Catalog pointer kind mismatch at {pointer_key}")
    manifest_key = str(pointer.get("manifest_key") or "")
    manifest = store.get_json(bucket, manifest_key)
    if not manifest:
        raise CatalogSnapshotError(f"Catalog manifest is missing: {manifest_key}")
    if pointer.get("manifest_sha256") != _sha256(_canonical_json(manifest)):
        raise CatalogSnapshotError(
            f"Catalog manifest checksum mismatch: {manifest_key}"
        )
    return load_catalog_snapshot(
        store, bucket, kind, str(pointer.get("snapshot_id") or "")
    )


def load_active_catalogs(store: ObjectStore, bucket: str) -> CatalogBundle:
    """Load all selected immutable snapshots, failing closed on corruption."""

    loaded = {kind: _load_kind(store, bucket, kind) for kind in CATALOG_SPECS}
    snapshots = {
        kind: snapshot_id
        for kind, value in loaded.items()
        if value is not None
        for snapshot_id, _ in [value]
    }
    return CatalogBundle(
        tic_records=list((loaded["TIC"] or ("", []))[1]),
        toi_records=list((loaded["TOI"] or ("", []))[1]),
        tce_records=list((loaded["TCE"] or ("", []))[1]),
        snapshot_ids=snapshots,
    )


def load_catalog_bundle(
    store: ObjectStore, bucket: str, snapshot_ids: dict[str, str]
) -> CatalogBundle:
    """Load a known immutable TIC/TOI bundle without changing global pointers."""
    loaded = {
        kind: load_catalog_snapshot(store, bucket, kind, snapshot_id)
        for kind, snapshot_id in snapshot_ids.items()
    }
    return CatalogBundle(
        tic_records=list((loaded.get("TIC") or ("", []))[1]),
        toi_records=list((loaded.get("TOI") or ("", []))[1]),
        tce_records=list((loaded.get("TCE") or ("", []))[1]),
        snapshot_ids={kind: snapshot_id for kind, (snapshot_id, _) in loaded.items()},
    )


def _request_json(request: Request, provider: str) -> Any:
    """Read one small provider response with bounded retries and no hidden fallback."""
    last_error: Exception | None = None
    for attempt in range(CATALOG_REQUEST_ATTEMPTS):
        try:
            with urlopen(request, timeout=45) as response:  # nosec B310 -- fixed HTTPS providers
                return json.loads(response.read())
        except (HTTPError, URLError, TimeoutError, json.JSONDecodeError) as exc:
            last_error = exc
            if attempt + 1 < CATALOG_REQUEST_ATTEMPTS:
                time.sleep(2**attempt)
    raise CatalogSyncError(
        f"{provider} catalog request failed after {CATALOG_REQUEST_ATTEMPTS} attempts: {last_error}"
    )


def fetch_tic_rows(tic_ids: Sequence[int]) -> list[dict[str, Any]]:
    """Retrieve only the required TIC rows from MAST's documented catalog API."""
    requested = sorted({int(tic_id) for tic_id in tic_ids if int(tic_id) > 0})
    rows: list[dict[str, Any]] = []
    for chunk in _chunked(requested, TIC_REQUEST_SIZE):
        payload = {
            "service": "Mast.Catalogs.Filtered.Tic.Rows",
            "format": "json",
            "params": {
                "columns": "ID,ra,dec,Tmag,Teff,rad,mass,logg",
                "filters": [{"paramName": "ID", "values": chunk}],
            },
        }
        request = Request(
            MAST_INVOKE_URL,
            data=urlencode(
                {"request": json.dumps(payload, separators=(",", ":"))}
            ).encode(),
            headers={
                "Content-Type": "application/x-www-form-urlencoded",
                "Accept": "application/json",
            },
        )
        response = _request_json(request, "MAST TIC")
        if not isinstance(response, dict) or response.get("status") != "COMPLETE":
            raise CatalogSyncError(
                f"MAST TIC returned an incomplete response: {response}"
            )
        data = response.get("data")
        if not isinstance(data, list) or not all(isinstance(row, dict) for row in data):
            raise CatalogSyncError("MAST TIC response has no valid data rows")
        rows.extend(
            {
                "tic_id": row.get("ID"),
                "ra": row.get("ra"),
                "dec": row.get("dec"),
                "tmag": row.get("Tmag"),
                "teff": row.get("Teff"),
                "rad": row.get("rad"),
                "mass": row.get("mass"),
                "logg": row.get("logg"),
            }
            for row in data
        )
    returned = {int(row["tic_id"]) for row in rows if row.get("tic_id") is not None}
    missing = sorted(set(requested) - returned)
    if missing:
        preview = ", ".join(map(str, missing[:8]))
        raise CatalogSyncError(
            f"MAST TIC response is missing {len(missing)} requested target(s): {preview}"
        )
    return rows


def fetch_toi_rows(tic_ids: Sequence[int]) -> list[dict[str, Any]]:
    """Retrieve TOI evidence only for the targets being materialized."""
    requested = sorted({int(tic_id) for tic_id in tic_ids if int(tic_id) > 0})
    rows: list[dict[str, Any]] = []
    for chunk in _chunked(requested, TOI_REQUEST_SIZE):
        identifiers = ",".join(map(str, chunk))
        query = (
            "select tid as tic_id, toi as toi_id, pl_orbper as period, "
            "pl_tranmid as epoch, pl_trandurh as duration, pl_trandep as depth, "
            f"tfopwg_disp from toi where tid in ({identifiers})"
        )
        request = Request(
            f"{NASA_EXOPLANET_ARCHIVE_TAP}?"
            + urlencode({"query": query, "format": "json"}),
            headers={"Accept": "application/json"},
        )
        response = _request_json(request, "NASA TOI")
        if not isinstance(response, list) or not all(
            isinstance(row, dict) for row in response
        ):
            raise CatalogSyncError("NASA TOI response is not a JSON row list")
        rows.extend(response)
    return rows


def sync_catalogs_for_tics(
    store: ObjectStore, bucket: str, tic_ids: Sequence[int]
) -> CatalogSyncResult:
    """Create or reuse immutable, target-scoped TIC and TOI snapshots.

    The cache key is the exact sorted target set.  A cached snapshot is fully
    checksum-validated before reuse, so a restart never turns a partially
    downloaded provider response into Gold evidence.
    """
    targets = sorted({int(tic_id) for tic_id in tic_ids if int(tic_id) > 0})
    scope = _target_scope(targets)
    snapshot_ids: dict[str, str] = {}
    for kind in ("TIC", "TOI"):
        pointer = store.get_json(bucket, _cache_key(kind, scope))
        if not pointer:
            continue
        if (
            pointer.get("schema_version") != "catalog-on-demand-cache-v1"
            or pointer.get("catalog_type") != kind
            or pointer.get("scope") != scope
        ):
            raise CatalogSnapshotError(
                f"Invalid on-demand {kind} cache pointer for target scope"
            )
        snapshot_ids[kind] = str(pointer.get("snapshot_id") or "")

    cache_hit = len(snapshot_ids) == 2
    if "TIC" not in snapshot_ids:
        active_tic = _load_kind(store, bucket, "TIC")
        if active_tic is not None:
            _, active_records = active_tic
            active_index = {record.tic_id: record for record in active_records}
            if all(tic_id in active_index for tic_id in targets):
                tic_rows = [active_index[tic_id].to_dict() for tic_id in targets]
                tic_provider = "Pinned shared MAST TIC snapshot"
                tic_source_uri = f"catalogs/current/tic.json#{active_tic[0]}"
            else:
                tic_rows = fetch_tic_rows(targets)
                tic_provider = "MAST/STScI"
                tic_source_uri = MAST_INVOKE_URL
        else:
            tic_rows = fetch_tic_rows(targets)
            tic_provider = "MAST/STScI"
            tic_source_uri = MAST_INVOKE_URL
        manifest = import_catalog_rows(
            store,
            bucket,
            "TIC",
            tic_rows,
            provider=tic_provider,
            source_uri=tic_source_uri,
            source_query=json.dumps(
                {
                    "service": "Mast.Catalogs.Filtered.Tic.Rows",
                    "target_tic_ids": targets,
                    "columns": "ID,ra,dec,Tmag,Teff,rad,mass,logg",
                },
                sort_keys=True,
                separators=(",", ":"),
            ),
            set_current=False,
            identity_scope=scope,
        )
        snapshot_ids["TIC"] = manifest.snapshot_id
        store.put_json(
            bucket,
            _cache_key("TIC", scope),
            {
                "schema_version": "catalog-on-demand-cache-v1",
                "catalog_type": "TIC",
                "scope": scope,
                "snapshot_id": manifest.snapshot_id,
            },
        )
    if "TOI" not in snapshot_ids:
        active_toi = _load_kind(store, bucket, "TOI")
        if active_toi is not None:
            _, active_records = active_toi
            target_set = set(targets)
            toi_rows = [record.to_dict() for record in active_records if record.tic_id in target_set]
            toi_provider = "Pinned shared NASA TOI snapshot"
            toi_source_uri = f"catalogs/current/toi.json#{active_toi[0]}"
        else:
            toi_rows = fetch_toi_rows(targets)
            toi_provider = "NASA Exoplanet Archive"
            toi_source_uri = NASA_EXOPLANET_ARCHIVE_TAP
        query = NASA_TOI_QUERY + " where tid in (" + ",".join(map(str, targets)) + ")"
        manifest = import_catalog_rows(
            store,
            bucket,
            "TOI",
            toi_rows,
            provider=toi_provider,
            source_uri=toi_source_uri,
            source_query=query,
            set_current=False,
            identity_scope=scope,
        )
        snapshot_ids["TOI"] = manifest.snapshot_id
        store.put_json(
            bucket,
            _cache_key("TOI", scope),
            {
                "schema_version": "catalog-on-demand-cache-v1",
                "catalog_type": "TOI",
                "scope": scope,
                "snapshot_id": manifest.snapshot_id,
            },
        )

    catalogs = load_catalog_bundle(store, bucket, snapshot_ids)
    if not catalogs.has("TIC") or not catalogs.has("TOI"):
        raise CatalogSyncError("On-demand catalog sync did not produce TIC + TOI")
    if {record.tic_id for record in catalogs.tic_records} != set(targets):
        raise CatalogSyncError("Verified TIC snapshot does not cover the Gold batch")
    return CatalogSyncResult(
        catalogs=catalogs,
        target_count=len(targets),
        tic_records=len(catalogs.tic_records),
        toi_records=len(catalogs.toi_records),
        cache_hit=cache_hit,
    )


def read_catalog_input(path: str) -> list[dict[str, Any]]:
    """Read an operator-supplied CSV or JSON catalog file without guessing it."""

    source = Path(path)
    if source.suffix.lower() == ".csv":
        with source.open(newline="", encoding="utf-8") as handle:
            return list(csv.DictReader(handle))
    if source.suffix.lower() == ".json":
        payload = json.loads(source.read_text(encoding="utf-8"))
        if isinstance(payload, dict):
            payload = payload.get("records")
        if not isinstance(payload, list) or not all(
            isinstance(row, dict) for row in payload
        ):
            raise ValueError(
                "JSON catalog input must be an array of objects or {'records': [...]}"
            )
        return payload
    raise ValueError("Catalog input must be .csv or .json")


def fetch_nasa_toi_catalog(
    timeout_seconds: float = 90.0,
) -> tuple[list[dict[str, Any]], str]:
    """Fetch the official TOI export for an explicit operator sync command.

    This function is intentionally never called by the Gold worker.  The
    fetched result is normalized and pinned by :func:`import_catalog_rows`
    before any candidate is labeled.
    """

    source_uri = f"{NASA_EXOPLANET_ARCHIVE_TAP}?" + urlencode(
        {"query": NASA_TOI_QUERY, "format": "json"}
    )
    with urlopen(source_uri, timeout=timeout_seconds) as response:  # nosec B310 -- fixed HTTPS endpoint
        payload = json.loads(response.read())
    if not isinstance(payload, list) or not all(
        isinstance(row, dict) for row in payload
    ):
        raise CatalogSnapshotError("NASA TOI endpoint returned an invalid payload")
    return payload, source_uri
