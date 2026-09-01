from prometheus_client import generate_latest

from aurora_ml.observer.metrics import Metrics


def test_idle_worker_exposes_complete_job_histogram_without_fake_rows() -> None:
    metrics = Metrics()
    payload = generate_latest(metrics.registry).decode()

    assert 'aurora_ml_jobs_total{operation="training",status="success"} 0.0' in payload
    assert 'aurora_ml_errors_total{operation="training"} 0.0' in payload
    assert 'aurora_ml_job_duration_seconds_count{operation="training"} 0.0' in payload
    assert "aurora_ml_rows_processed_total" not in payload
