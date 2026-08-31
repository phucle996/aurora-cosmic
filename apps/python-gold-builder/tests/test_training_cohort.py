import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "src"))

from aurora.gold_builder.application.training_cohort import auto_label_candidate


def test_auto_label_requires_catalog_and_pixel_evidence_for_positive():
    label = auto_label_candidate(
        {
            "toi_match_status": "EPHEMERIS_MATCH",
            "transit_evidence_available": True,
            "bls_available": True,
        }
    )
    assert label.label == "POSITIVE"
    assert label.train_eligible is True


def test_no_toi_is_not_negative_without_a_pixel_veto():
    label = auto_label_candidate(
        {
            "toi_match_status": "NO_TOI_FOR_TARGET",
            "transit_evidence_available": True,
            "bls_available": True,
        }
    )
    assert label.label == "UNRESOLVED"
    assert label.train_eligible is False


def test_clean_tpf_veto_creates_auto_negative():
    label = auto_label_candidate(
        {
            "toi_match_status": "NO_TOI_FOR_TARGET",
            "transit_evidence_available": False,
            "bls_available": True,
        }
    )
    assert label.label == "NEGATIVE"
    assert label.train_eligible is True
