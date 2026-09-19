FROM python:3.12-slim

WORKDIR /app
ENV PYTHONUNBUFFERED=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY python-enrichment/pyproject.toml python-enrichment/README.md ./
COPY python-enrichment/pipeline ./pipeline
COPY python-enrichment/runtime ./runtime
COPY python-enrichment/storage ./storage
COPY python-enrichment/config.py python-enrichment/events.py python-enrichment/metrics.py python-enrichment/service.py python-enrichment/__init__.py ./
RUN python -m pip install --no-cache-dir .

# Enrichment stage reuses the audited Stage 5 scientific pipeline without pulling
# the GPU-only ML dependencies into this CPU image.
COPY python-ml-worker/aurora_ml/__init__.py ./aurora_ml/__init__.py
COPY python-ml-worker/aurora_ml/pipeline ./aurora_ml/pipeline

EXPOSE 8088

CMD ["python", "service.py"]
