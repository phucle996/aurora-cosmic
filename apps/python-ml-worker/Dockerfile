FROM python:3.12-slim
WORKDIR /app
ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1
COPY pyproject.toml README.md ./
COPY aurora_ml ./aurora_ml
COPY pkg ./pkg
# Install the pinned CUDA-enabled PyTorch release from the canonical PyPI
# index. Keeping the version exact prevents the resolver from selecting a
# newer CUDA generation; using one index also avoids stale mirror hashes.
RUN python -m pip install --no-cache-dir .
HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import torch; assert torch.cuda.is_available(), 'CUDA is required'"
CMD ["python", "-m", "aurora_ml.main"]
