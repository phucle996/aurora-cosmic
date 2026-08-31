FROM python:3.12-slim
WORKDIR /app
ENV NVIDIA_VISIBLE_DEVICES=all \
    NVIDIA_DRIVER_CAPABILITIES=compute,utility \
    PYTHONUNBUFFERED=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

COPY pyproject.toml README.md ./
COPY pkg ./pkg
COPY aurora_ml ./aurora_ml
RUN python -m pip install --no-cache-dir -e .

HEALTHCHECK --interval=30s --timeout=5s --retries=3 CMD python -c "import torch; assert torch.cuda.is_available(), 'CUDA is required'"
CMD ["python", "-m", "aurora_ml.service"]
