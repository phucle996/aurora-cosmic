from prometheus_client import generate_latest

from aurora.gold_builder.observer import Metrics


def test_metrics_expose_idle_contract_and_successful_build() -> None:
    metrics = Metrics()
    idle = generate_latest(metrics.registry).decode()
    assert 'aurora_gold_batches_total{status="success"} 0.0' in idle
    assert 'aurora_gold_batches_total{status="failed"} 0.0' in idle
    assert 'aurora_gold_batches_total{status="deferred"} 0.0' in idle
    assert "aurora_gold_batch_duration_seconds_bucket" in idle

    metrics.set_queue_depth(2)
    metrics.build_started()
    metrics.build_finished(
        "success",
        1.25,
        input_records=4,
        output_rows=12,
    )
    observed = generate_latest(metrics.registry).decode()
    assert 'aurora_gold_batches_total{status="success"} 1.0' in observed
    assert "aurora_gold_inflight_builds 0.0" in observed
    assert "aurora_gold_queue_depth 2.0" in observed
    assert "aurora_gold_input_records_total 4.0" in observed
    assert "aurora_gold_output_rows_total 12.0" in observed
