import pytest

from aurora_ml.domain.training import TrainingRequest, TrainingRequestError


def test_training_request_requires_explicit_committed_gold_selection():
    with pytest.raises(TrainingRequestError, match="MISSING_GOLD_SNAPSHOT_ID"):
        TrainingRequest.from_payload(
            {
                "training_job_id": "train-1",
                "task": "candidate_vetting",
                "compute_target": "cpu",
            }
        )


def test_training_request_preserves_dashboard_batch_size():
    request = TrainingRequest.from_payload(
        {
            "training_job_id": "train-1",
            "task": "candidate_vetting",
            "gold_snapshot_id": "gold-v1-123456789abc",
            "compute_target": "cpu",
            "batch_size": 17,
        }
    )
    assert request.batch_size == 17
