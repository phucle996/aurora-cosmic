FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY python-gold-builder/pyproject.toml python-gold-builder/README.md ./
COPY python-gold-builder/aurora_gold_builder ./aurora_gold_builder
RUN python -m pip install --no-cache-dir .

# Gold Builder reuses the audited Stage 5 scientific pipeline without pulling
# the GPU-only ML dependencies into this CPU image.
COPY python-ml-worker/aurora_ml/__init__.py ./aurora_ml/__init__.py
COPY python-ml-worker/aurora_ml/pipeline ./aurora_ml/pipeline

CMD ["python", "-m", "aurora_gold_builder", "worker"]
