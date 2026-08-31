"""MinIO adapter with immutable writes and bounded, closed reads."""

from __future__ import annotations

import hashlib
import io
import json
from pathlib import Path
from typing import Any, Iterable

from minio import Minio

from aurora_ml.config import Config


class ObjectStoreError(RuntimeError):
    pass


class ImmutableObjectConflict(ObjectStoreError):
    pass


class MinioObjectStore:
    def __init__(self, config: Config):
        endpoint = config.minio_endpoint.removeprefix("http://").removeprefix(
            "https://"
        )
        self.bucket = config.minio_bucket
        self.client = Minio(
            endpoint,
            access_key=config.minio_access_key,
            secret_key=config.minio_secret_key,
            secure=config.minio_secure,
        )

    @staticmethod
    def sha256(data: bytes) -> str:
        return hashlib.sha256(data).hexdigest()

    def read_bytes(self, key: str) -> bytes:
        response = self.client.get_object(self.bucket, key)
        try:
            return response.read()
        finally:
            response.close()
            response.release_conn()

    def read_json(self, key: str) -> dict[str, Any]:
        try:
            value = json.loads(self.read_bytes(key))
        except Exception as exc:
            raise ObjectStoreError(f"INVALID_JSON_OBJECT: {key}") from exc
        if not isinstance(value, dict):
            raise ObjectStoreError(f"JSON_OBJECT_EXPECTED: {key}")
        return value

    def put_immutable(self, key: str, data: bytes, content_type: str) -> str:
        digest = self.sha256(data)
        try:
            existing = self.read_bytes(key)
        except Exception:
            existing = None
        if existing is not None:
            if self.sha256(existing) != digest:
                raise ImmutableObjectConflict(f"IMMUTABLE_OBJECT_CONFLICT: {key}")
            return digest
        self.client.put_object(
            self.bucket, key, io.BytesIO(data), len(data), content_type=content_type
        )
        return digest

    def put_json_immutable(self, key: str, value: dict[str, Any]) -> str:
        data = json.dumps(value, sort_keys=True, separators=(",", ":")).encode()
        return self.put_immutable(key, data, "application/json")

    def put_file_immutable(self, key: str, path: Path, content_type: str) -> str:
        data = path.read_bytes()
        return self.put_immutable(key, data, content_type)

    def download(self, key: str, destination: Path) -> None:
        destination.parent.mkdir(parents=True, exist_ok=True)
        response = self.client.get_object(self.bucket, key)
        try:
            with destination.open("wb") as handle:
                for chunk in response.stream(1024 * 1024):
                    handle.write(chunk)
        finally:
            response.close()
            response.release_conn()

    def list_keys(self, prefix: str) -> Iterable[str]:
        for item in self.client.list_objects(
            self.bucket, prefix=prefix, recursive=True
        ):
            if item.object_name:
                yield item.object_name
