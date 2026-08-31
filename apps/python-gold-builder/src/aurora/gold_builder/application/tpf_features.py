"""Bounded-memory TPF feature extraction from verified Silver Parquet."""

from __future__ import annotations

from contextlib import nullcontext
import hashlib
from pathlib import Path
import tempfile
from typing import Any

import numpy as np
import pyarrow.parquet as pq

from aurora_ml.pipeline.evidence import extract_tpf_features_from_silver_cube

from ..domain.events import SilverEvent
from ..infrastructure.object_store import ObjectStore

TPF_BATCH_CADENCES = 256
# Typical preprocessed TPF cubes are only a few MiB. Keeping those bounded
# cubes in RAM avoids the write+flush+read cycle of a scratch memmap. Large
# cubes still use disk, but an advisory process-wide lock prevents concurrent
# flushes from wedging the local filesystem during a Gold batch.
TPF_IN_MEMORY_CUBE_LIMIT_BYTES = 64 * 1024 * 1024
TPF_MEMMAP_LOCK_NAME = ".aurora-gold-tpf-memmap.lock"


class TpfFeatureError(ValueError):
    """A verified Silver TPF cannot be materialized into scientific evidence."""


def _sha256_file(path: Path) -> str:
    digest = hashlib.sha256()
    with path.open("rb") as file:
        while chunk := file.read(1024 * 1024):
            digest.update(chunk)
    return digest.hexdigest()


def _float_values(values: list[Any]) -> np.ndarray:
    return np.asarray(
        [np.nan if value is None else value for value in values], dtype=np.float64
    )


def _required_column(parquet: pq.ParquetFile, name: str) -> None:
    if name not in parquet.schema_arrow.names:
        raise TpfFeatureError(f"Silver TPF is missing required column '{name}'")


def _cube_byte_size(cadence_count: int, dimensions: tuple[int, int]) -> int:
    return cadence_count * dimensions[0] * dimensions[1] * np.dtype(np.float64).itemsize


def _large_cube_lock(scratch_path: Path):
    """Serialize only large disk-backed cubes across process-pool workers."""
    try:
        import fcntl
    except ImportError:  # pragma: no cover - Gold Builder is deployed on Linux.
        return nullcontext()

    lock_path = scratch_path / TPF_MEMMAP_LOCK_NAME
    handle = lock_path.open("a+")

    class LockContext:
        def __enter__(self):
            fcntl.flock(handle.fileno(), fcntl.LOCK_EX)
            return self

        def __exit__(self, exc_type, exc_value, traceback):
            fcntl.flock(handle.fileno(), fcntl.LOCK_UN)
            handle.close()
            return False

    return LockContext()


def extract_tpf_row(
    store: ObjectStore,
    event: SilverEvent,
    lightcurve_features: Any | None,
    scratch_dir: str | Path | None = None,
    feature_version: str = "tpf-vetting-v1",
) -> dict[str, Any]:
    """Build exact TPF evidence without materializing the Parquet or cube in RAM."""
    scratch_path = Path(scratch_dir) if scratch_dir else None
    if scratch_path is not None:
        scratch_path.mkdir(parents=True, exist_ok=True)
    with tempfile.TemporaryDirectory(
        prefix="aurora-gold-tpf-", dir=scratch_path
    ) as temporary_dir:
        temporary_path = Path(temporary_dir)
        parquet_path = temporary_path / "silver-tpf.parquet"
        store.download_file(event.bucket, event.object_key, parquet_path)
        actual_sha = _sha256_file(parquet_path)
        if actual_sha != event.sha256:
            raise TpfFeatureError(
                f"Silver checksum mismatch for {event.object_key}: "
                f"expected {event.sha256}, got {actual_sha}"
            )
        try:
            parquet = pq.ParquetFile(parquet_path)
        except Exception as exc:
            raise TpfFeatureError(
                f"Unable to read Silver TPF Parquet {event.object_key}: {exc}"
            ) from exc
        for column in ("time", "flux", "rows", "cols"):
            _required_column(parquet, column)
        cadence_count = parquet.metadata.num_rows
        if cadence_count <= 0:
            raise TpfFeatureError("Silver TPF contains no cadences")

        time = np.empty(cadence_count, dtype=np.float64)
        dimensions: tuple[int, int] | None = None
        offset = 0
        cube: np.ndarray | np.memmap | None = None
        cube_lock = nullcontext()
        try:
            for batch in parquet.iter_batches(
                batch_size=TPF_BATCH_CADENCES,
                columns=["time", "flux", "rows", "cols"],
            ):
                batch_size = batch.num_rows
                if batch_size == 0:
                    continue
                rows_values = batch.column("rows").to_pylist()
                cols_values = batch.column("cols").to_pylist()
                if None in rows_values or None in cols_values:
                    raise TpfFeatureError("Silver TPF has missing rows/cols values")
                batch_dimensions = {
                    (int(rows), int(cols))
                    for rows, cols in zip(rows_values, cols_values)
                }
                if len(batch_dimensions) != 1:
                    raise TpfFeatureError(
                        "Silver TPF has inconsistent rows/cols values"
                    )
                current_dimensions = next(iter(batch_dimensions))
                if current_dimensions[0] <= 0 or current_dimensions[1] <= 0:
                    raise TpfFeatureError("Silver TPF rows and cols must be positive")
                if dimensions is None:
                    dimensions = current_dimensions
                    shape = (cadence_count, dimensions[0] * dimensions[1])
                    if (
                        _cube_byte_size(cadence_count, dimensions)
                        <= TPF_IN_MEMORY_CUBE_LIMIT_BYTES
                    ):
                        cube = np.empty(shape, dtype=np.float64)
                    else:
                        cube_lock = _large_cube_lock(scratch_path or temporary_path)
                        cube_lock.__enter__()
                        cube = np.memmap(
                            temporary_path / "flux-cube.dat",
                            mode="w+",
                            dtype=np.float64,
                            shape=shape,
                        )
                elif dimensions != current_dimensions:
                    raise TpfFeatureError(
                        "Silver TPF changes dimensions between cadences"
                    )
                if cube is None:
                    raise TpfFeatureError("Unable to allocate disk-backed TPF cube")

                end = offset + batch_size
                time[offset:end] = _float_values(batch.column("time").to_pylist())
                flux_values = batch.column("flux").to_pylist()
                for index, flux in enumerate(flux_values):
                    pixels = np.asarray(
                        flux if flux is not None else [], dtype=np.float64
                    )
                    if len(pixels) != dimensions[0] * dimensions[1]:
                        raise TpfFeatureError(
                            "Silver TPF cadence has invalid pixel count at "
                            f"index {offset + index}"
                        )
                    cube[offset + index] = pixels
                offset = end

            if dimensions is None or cube is None or offset != cadence_count:
                raise TpfFeatureError(
                    "Silver TPF cadence count does not match its Parquet footer"
                )
            if isinstance(cube, np.memmap):
                cube.flush()
            features = extract_tpf_features_from_silver_cube(
                tpf_input_ref=event.to_input_ref(),
                time_arr=time,
                cube=cube,
                rows=dimensions[0],
                cols=dimensions[1],
                lc_features=lightcurve_features,
                feature_version=feature_version,
            )
        finally:
            if cube is not None:
                if isinstance(cube, np.memmap):
                    cube.flush()
                del cube
            cube_lock.__exit__(None, None, None)

    row = features.to_dict()
    row.update(
        {
            "sample_id": event.effective_sample_id,
            "tic_id": event.tic_id,
            "sector": int(event.sector),
        }
    )
    return row
