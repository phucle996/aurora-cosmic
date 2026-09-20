from prometheus_client import generate_latest

from metrics import Metrics


def test_metrics_expose_idle_contract_and_successful_build() -> None:
    metrics = Metrics()
    idle = generate_latest(metrics.registry).decode()
    assert 'aurora_gold_batches_total{status="success"} 0.0' in idle
    assert 'aurora_gold_batches_total{status="failed"} 0.0' in idle
    assert 'aurora_gold_batches_total{status="deferred"} 0.0' in idle
    assert "aurora_gold_batch_duration_seconds_bucket" in idle
    assert "aurora_enrichment_pairing_waiting 0.0" in idle

    metrics.set_queue_depth(2)
    metrics.build_started()
    metrics.record_pairing(5, dropped=1)
    metrics.record_catalog_sync(10, 2, elapsed_seconds=0.45, cache_hit=True)
    metrics.record_step("lc_features", elapsed_seconds=0.12, records=5)
    metrics.record_step("bls", elapsed_seconds=0.85, records=3)
    metrics.bls_candidates.inc(3)
    metrics.record_step("tpf_vetting", elapsed_seconds=0.34, records=5)
    metrics.tpf_transit_evidence.inc(4)
    metrics.record_step("candidate", elapsed_seconds=0.08, records=5)
    metrics.candidates_assembled.inc(5)
    metrics.record_parquet_write(elapsed_seconds=0.25, byte_count=1048576)
    metrics.record_clickhouse_index(elapsed_seconds=0.18, row_count=5)

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

    # 7 steps verification
    assert "aurora_enrichment_paired_pairs_total 5.0" in observed
    assert "aurora_enrichment_pairing_dropped_total 1.0" in observed
    assert 'aurora_enrichment_catalog_records_total{catalog="TIC"} 10.0' in observed
    assert 'aurora_enrichment_catalog_records_total{catalog="TOI"} 2.0' in observed
    assert "aurora_enrichment_catalog_cache_hits_total 1.0" in observed
    assert "aurora_enrichment_bls_candidates_detected_total 3.0" in observed
    assert "aurora_enrichment_tpf_transit_evidence_total 4.0" in observed
    assert "aurora_enrichment_candidate_assembled_total 5.0" in observed
    assert "aurora_enrichment_parquet_bytes_total 1.048576e+06" in observed
    assert "aurora_enrichment_clickhouse_indexed_rows_total 5.0" in observed
