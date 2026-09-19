"""Small object-store abstraction used by the builder and its tests."""

from __future__ import annotations

from dataclasses import dataclass, field
import io
import json
from pathlib import Path
from typing import Any, Dict, Iterable, Protocol
from urllib.parse import urlparse


class ObjectStore(Protocol):
    def get_bytes(self, bucket: str, key: str) -> bytes: ...

    def download_file(self, bucket: str, key: str, destination: Path) -> None: ...

    def put_bytes(
        self, bucket: str, key: str, data: bytes, content_type: str
    ) -> None: ...

    def get_json(self, bucket: str, key: str) -> Dict[str, Any] | None: ...

    def put_json(self, bucket: str, key: str, payload: Dict[str, Any]) -> None: ...

    def list_keys(self, bucket: str, prefix: str) -> Iterable[str]: ...

    def delete(self, bucket: str, key: str) -> None: ...


class MinioObjectStore:
    def __init__(self, endpoint: str, access_key: str, secret_key: str):
        from minio import Minio

        parsed = urlparse(endpoint)
        if not parsed.hostname:
            raise ValueError(f"Invalid MINIO_ENDPOINT: {endpoint}")
        address = parsed.hostname
        if parsed.port:
            address = f"{address}:{parsed.port}"
        self.client = Minio(
            address,
            access_key=access_key,
            secret_key=secret_key,
            secure=parsed.scheme == "https",
        )

    def get_bytes(self, bucket: str, key: str) -> bytes:
        response = self.client.get_object(bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def download_file(self, bucket: str, key: str, destination: Path) -> None:
        self.client.fget_object(bucket, key, str(destination))

    def put_bytes(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        self.client.put_object(
            bucket,
            key,
            io.BytesIO(data),
            length=len(data),
            content_type=content_type,
        )

    def get_json(self, bucket: str, key: str) -> Dict[str, Any] | None:
        try:
            return json.loads(self.get_bytes(bucket, key).decode("utf-8"))
        except Exception as exc:
            from minio.error import S3Error

            if isinstance(exc, S3Error) and exc.code in {"NoSuchKey", "NoSuchBucket"}:
                return None
            raise

    def put_json(self, bucket: str, key: str, payload: Dict[str, Any]) -> None:
        data = json.dumps(payload, sort_keys=True, separators=(",", ":")).encode()
        self.put_bytes(bucket, key, data, "application/json")

    def list_keys(self, bucket: str, prefix: str) -> Iterable[str]:
        return (
            item.object_name
            for item in self.client.list_objects(bucket, prefix=prefix, recursive=True)
        )

    def delete(self, bucket: str, key: str) -> None:
        self.client.remove_object(bucket, key)


@dataclass
class MemoryObjectStore:
    """In-memory store used for deterministic builder tests."""

    objects: Dict[tuple[str, str], bytes] = field(default_factory=dict)

    def get_bytes(self, bucket: str, key: str) -> bytes:
        return self.objects[(bucket, key)]

    def download_file(self, bucket: str, key: str, destination: Path) -> None:
        destination.write_bytes(self.get_bytes(bucket, key))

    def put_bytes(self, bucket: str, key: str, data: bytes, content_type: str) -> None:
        del content_type
        self.objects[(bucket, key)] = bytes(data)

    def get_json(self, bucket: str, key: str) -> Dict[str, Any] | None:
        data = self.objects.get((bucket, key))
        return json.loads(data.decode("utf-8")) if data is not None else None

    def put_json(self, bucket: str, key: str, payload: Dict[str, Any]) -> None:
        self.put_bytes(
            bucket,
            key,
            json.dumps(payload, sort_keys=True).encode(),
            "application/json",
        )

    def list_keys(self, bucket: str, prefix: str) -> Iterable[str]:
        return sorted(
            key for b, key in self.objects if b == bucket and key.startswith(prefix)
        )

    def delete(self, bucket: str, key: str) -> None:
        self.objects.pop((bucket, key), None)
