FROM python:3.12-slim
WORKDIR /app
COPY pyproject.toml README.md ./
COPY . .
RUN pip install --no-cache-dir .
EXPOSE 8501
CMD ["python", "app.py"]
