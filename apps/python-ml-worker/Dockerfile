FROM python:3.11-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY aurora_ml ./aurora_ml
RUN pip install --no-cache-dir .
CMD ["python", "-m", "aurora_ml.main"]
