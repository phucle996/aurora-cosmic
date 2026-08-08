````md id="phase-6-4"
# CHECKLIST_PHASE_6_4.md

# Stage 6 — Machine Learning Training, Evaluation & Model Registry
## Phase 6.4 — Evaluation: Golden Test & Recent Holdout

Status: TODO

Goal:

> Evaluate completed candidate-vetting and anomaly-detection training runs on
> data that was never used to fit:
>
> - model weights,
> - preprocessing parameters,
> - early stopping,
> - decision thresholds.
>
> Phase 6.4 introduces:
>
> - immutable Golden Test cohorts,
> - rolling Recent Holdout cohorts,
> - strict group-contamination checks,
> - validation-only threshold selection,
> - final candidate Golden Test metrics,
> - recent-distribution evaluation,
> - anomaly reconstruction threshold semantics,
> - deterministic synthetic anomaly sanity evaluation,
> - immutable evaluation-run artifacts.
>
> The central rule is:
>
>     TRAIN / VALIDATION
>         may influence the model.
>
>     GOLDEN TEST
>         must never influence the model.
>
>     RECENT HOLDOUT
>         must never influence the model being evaluated.
>
> AURORA must never retrofit a "golden test" from targets that the model has
> already seen during TRAIN or VALIDATION.

---

# 1. Important Correction From Phase 6.1

Phase 6.1 development splits currently contain:

```text
TRAIN
VALIDATION
````

and may have assigned all currently supervised target groups.

Therefore Phase 6.4 MUST NOT do this:

```text
existing TRAIN / VALIDATION universe
          |
          v
pick some rows afterwards
          |
          v
call them GOLDEN TEST
```

That is invalid.

---

# 2. Golden Test Must Be Truly Unseen

For one training run define:

```text
development_exposed_groups =
    TRAIN groups
    UNION
    VALIDATION groups
```

A valid Golden Test group must satisfy:

```text
golden_group
NOT IN
development_exposed_groups
```

Mandatory.

---

# 3. Valid First Golden-Test Source

Recommended V1:

```text
training Gold snapshot A
        |
        v
train + validation
        |
        v
completed training run

later / independent committed Gold snapshot B
        |
        v
eligible groups not exposed in A split
        |
        v
freeze GOLDEN TEST
```

Snapshot B may be cumulative.

Training groups appearing again in B are filtered out.

---

# 4. Do Not Require Bronze/Silver

Evaluation consumes:

```text
Gold
training-run artifacts
split manifests
evaluation cohort manifests
```

Expected:

```text
Bronze reads = 0

Silver reads = 0
```

---

# 5. RAW_DELETED Remains Valid

This remains valid:

```text
Bronze = RAW_DELETED
        |
        X
        |
Gold
training run
evaluation
```

No raw restoration.

---

# 6. ClickHouse Is Optional

Canonical evaluation must NOT depend on:

```text
ClickHouse
```

It may be used for exploratory inspection only.

Required evaluation path:

```text
Gold Parquet
    +
immutable manifests
```

---

# 7. No Live Catalog Queries

Do NOT query:

```text
TIC
TOI
TCE
```

during evaluation.

Candidate labels are pinned by the exact Gold snapshot used for the cohort.

---

# 8. No NATS Requirement

Phase 6.4 is an explicit batch evaluation workflow.

Do not add:

```text
evaluation-ready NATS events
```

---

# 9. Evaluation Families

Phase 6.4 evaluates:

```text
candidate_vetting

astronomical_anomaly_detection
```

with task-specific policies.

Do not force one metric set onto both tasks.

---

# 10. Evaluation Cohort Artifact

Introduce immutable evaluation cohorts.

Recommended storage:

```text
evaluations/
└── cohorts/
    ├── candidate/
    │   ├── golden/
    │   └── recent/
    │
    └── anomaly/
        ├── golden/
        └── recent/
```

---

# 11. Golden Cohort Path

Recommended:

```text
evaluations/cohorts/candidate/golden/<cohort-id>/manifest.json
```

and:

```text
evaluations/cohorts/anomaly/golden/<cohort-id>/manifest.json
```

---

# 12. Recent Cohort Path

Recommended:

```text
evaluations/cohorts/candidate/recent/<cohort-id>/manifest.json
```

and:

```text
evaluations/cohorts/anomaly/recent/<cohort-id>/manifest.json
```

---

# 13. Cohort Contract

Create:

```text
contracts/data/ml-evaluation-cohort-v1.md
```

One generic immutable cohort contract is sufficient.

---

# 14. Cohort Kinds

V1:

```text
GOLDEN_TEST

RECENT_HOLDOUT
```

Do not confuse them with:

```text
TRAIN
VALIDATION
```

---

# 15. Cohort Manifest Fields

Conceptual:

```text
schema_version

cohort_id

cohort_fingerprint

task

cohort_kind

source_gold_snapshot_id

source_gold_manifest_sha256

dataset_view_version

dataset_view_fingerprint

selection_policy_version

excluded_group_cohort_ids

group_count

row_count

group_keys

created_at

producer
```

Candidate cohort may also record:

```text
positive_count
negative_count
```

---

# 16. Cohort Manifest Stores Groups

Prefer storing:

```text
group_keys
```

instead of copying all Gold feature vectors.

Rows are reconstructed from:

```text
exact Gold snapshot
+
dataset view
+
group keys
```

---

# 17. Canonical Group Ordering

Sort:

```text
group_keys ASC
```

before:

```text
fingerprinting
writing
```

---

# 18. Cohort Identity

Compute deterministic:

```text
cohort_fingerprint =
SHA256(
    cohort kind
    +
    task
    +
    source Gold snapshot
    +
    source Gold manifest SHA
    +
    dataset view
    +
    selection policy
    +
    canonical group keys
)
```

---

# 19. Cohort ID

Example:

```text
golden-v1-<sha-prefix>

recent-v1-<sha-prefix>
```

Persist full fingerprint.

---

# 20. Cohort ID Ignores Clock

Do NOT include:

```text
created_at

hostname

random UUID
```

in cohort identity.

---

# 21. Cohort Is Immutable

Once:

```text
manifest.json
```

is committed:

```text
do not add groups

do not remove groups

do not relabel using today's catalog

do not change source Gold snapshot
```

---

# 22. Label Changes Require New Cohort

If a future label snapshot changes Gold labels:

```text
Golden cohort V1 remains unchanged
```

A deliberately updated benchmark becomes:

```text
Golden cohort V2
```

Do not silently relabel V1.

---

# 23. Golden Benchmark Permanence

A frozen Golden Test is intended for repeated comparable evaluation.

Therefore future training splits should avoid its target groups.

---

# 24. Future Split Reservation

After Golden Test exists:

```text
future TRAIN / VALIDATION
```

should exclude:

```text
frozen golden group keys
```

to preserve benchmark integrity.

---

# 25. Do Not Silently Change `ml-split-v1`

If the existing:

```text
ml-split-v1
```

contract cannot record reserved benchmark cohorts cleanly:

```text
introduce ml-split-v2
```

with:

```text
reserved_cohort_ids
```

or equivalent explicit exclusion provenance.

Do NOT silently change frozen V1 semantics.

---

# 26. Split Reservation Rule

Future split manifest should be able to answer:

```text
Which frozen benchmark cohorts were excluded from training?
```

This is essential once a Golden Test exists.

---

# 27. Existing V1 Training Runs Remain Valid

Do not rewrite old:

```text
ml-split-v1
```

manifests.

For those runs, Golden Test eligibility is proven by:

```text
golden groups
INTERSECT
development groups
=
empty
```

---

# 28. Candidate Golden Selection Policy

Introduce:

```text
candidate-golden-unseen-v1
```

---

# 29. Candidate Golden Source

Input:

```text
completed candidate training run
+
explicit committed candidate Gold snapshot
```

The source snapshot may be newer/cumulative.

---

# 30. Candidate Golden Eligible Labels

Only:

```text
POSITIVE

NEGATIVE
```

may participate in supervised final metrics.

---

# 31. Candidate Golden Excludes Development Groups

Mandatory:

```text
candidate golden group
NOT IN
training split TRAIN groups

candidate golden group
NOT IN
training split VALIDATION groups
```

---

# 32. Previously Unresolved Target

A target that existed in older Gold as:

```text
UNRESOLVED
```

but was never part of:

```text
TRAIN
VALIDATION
```

may later become eligible Golden Test data after a versioned label update.

This is valid because its features were not used for model fitting or
validation.

---

# 33. Partially Exposed Target

If one row from TIC 123 was in TRAIN:

```text
all future rows for TIC 123
```

are contaminated for that training run's Golden Test.

Exclude the entire group.

---

# 34. Golden Test Uses All Selected Group Rows

Once a group qualifies:

```text
include all supervised eligible rows
```

for that group from the frozen source Gold snapshot.

Do not cherry-pick easiest rows.

---

# 35. No Golden Class Balancing

Do NOT:

```text
oversample positives

undersample negatives
```

in Golden Test.

Preserve natural frozen cohort distribution.

---

# 36. Golden Class Coverage

Candidate Golden Test requires:

```text
>= 1 positive group/row

>= 1 negative group/row
```

for functional binary metrics.

Prefer more data in real evaluation.

---

# 37. Tiny Golden Warning

If Golden Test is very small:

```text
evaluation remains reproducible
```

but documentation must state:

```text
high statistical uncertainty
```

Do not make strong scientific claims.

---

# 38. Candidate Golden Freeze Command

Recommended:

```bash
python -m aurora_ml.main evaluation-cohort \
    --task candidate \
    --kind golden \
    --training-run-id <run-id> \
    --snapshot-id <evaluation-gold-id>
```

---

# 39. Candidate Recent Holdout Policy

Introduce:

```text
candidate-recent-sector-v1
```

---

# 40. Recent Holdout Meaning

Recent Holdout should represent:

```text
newer observation context
+
target groups unseen by the model
```

not merely another random sample.

---

# 41. Training Sector Cutoff

Derive:

```text
training_max_sector
```

from the exact candidate Gold snapshot used by the training run.

---

# 42. Candidate Recent Eligibility

Recommended V1:

```text
training_label in {POSITIVE, NEGATIVE}

sector > training_max_sector

group_key not in TRAIN

group_key not in VALIDATION

group_key not in GOLDEN TEST
```

---

# 43. Existing TIC In New Sector

If TIC 123 appeared in training and later appears in sector 50:

```text
exclude TIC 123
```

from Recent Holdout.

New observation does not erase target leakage.

---

# 44. Recent Holdout Uses Explicit Gold Snapshot

User/evaluator provides:

```text
recent_gold_snapshot_id
```

Do not query:

```text
whatever Gold is latest today
```

without pinning exact ID.

---

# 45. Recent Cohort Is Immutable Per Snapshot

Each recent evaluation cohort is immutable.

Example:

```text
recent-A from Gold snapshot 50

recent-B from Gold snapshot 55
```

Both may coexist.

---

# 46. Recent Is Rolling Conceptually

Unlike Golden Test:

```text
Recent Holdout may evolve
```

as new Gold snapshots arrive.

But each individual recent cohort remains immutable.

---

# 47. Recent Holdout May Later Become Training Data

A recent cohort used to evaluate model A may later be included in training
model B.

That is allowed.

But:

```text
model B
```

must NOT claim that same cohort as unseen Recent Holdout.

Evaluator contamination checks must reject it.

---

# 48. Candidate Recent Class Coverage

For official supervised metrics, prefer both:

```text
POSITIVE
NEGATIVE
```

If only one class exists:

```text
evaluation status =
INSUFFICIENT_CLASS_COVERAGE
```

Do not fabricate ROC/PR metrics.

---

# 49. Candidate Training Run Input

Evaluation starts from an immutable completed:

```text
training-runs/candidate/<run-id>/manifest.json
```

---

# 50. Verify Candidate Training Run

Before evaluation verify:

```text
manifest valid

model.pt checksum valid

preprocessing.json checksum valid

metrics.json checksum valid

Gold snapshot valid

split manifest valid
```

---

# 51. No Model Retraining

Phase 6.4 must NOT call:

```text
optimizer.step()
```

for a completed candidate model.

Evaluation is read-only with respect to training artifacts.

---

# 52. Candidate Validation Reconstruction

Phase 6.2 did not need durable row predictions.

Phase 6.4 may reconstruct:

```text
VALIDATION rows
```

from:

```text
training Gold
+
split manifest
```

and run the frozen native model.

---

# 53. Candidate Threshold Selection

Introduce:

```text
candidate-threshold-max-f1-v1
```

Threshold is selected using:

```text
VALIDATION only
```

---

# 54. Golden Test Never Selects Threshold

Mandatory:

```text
Golden Test
    ->
metrics only
```

Never:

```text
Golden Test
    ->
threshold tuning
```

---

# 55. Recent Holdout Never Selects Threshold

Same rule.

---

# 56. Candidate Threshold Candidates

Given validation probabilities:

```text
p_1 ... p_n
```

construct deterministic candidate thresholds from:

```text
sorted unique validation probabilities
```

plus boundary values if needed.

---

# 57. Classification Rule

Freeze:

```text
POSITIVE prediction
iff
probability >= threshold
```

---

# 58. Threshold Objective

For each candidate threshold compute:

```text
F1
```

on VALIDATION.

Select:

```text
maximum F1
```

---

# 59. Candidate Threshold Tie Break

If multiple thresholds have same F1 within exact metric semantics:

```text
1. higher recall
2. higher precision
3. lower threshold
```

This final tie break favors recall for candidate vetting.

---

# 60. Threshold Policy Is Versioned

Any change to:

```text
objective

tie break

classification comparison
```

requires:

```text
candidate-threshold-...-v2
```

---

# 61. Threshold Value Is Durable

Persist exact selected:

```text
decision_threshold
```

in the Phase 6.4 evaluation artifact.

---

# 62. Threshold Is Not Training Artifact

Do NOT mutate:

```text
training-runs/candidate/<run-id>/
```

to insert the threshold.

Training run remains immutable.

---

# 63. Candidate Golden Ranking Metrics

Compute:

```text
golden_pr_auc

golden_roc_auc
```

using continuous candidate probabilities.

---

# 64. Candidate Golden Threshold Metrics

At the frozen validation-selected threshold compute:

```text
golden_precision

golden_recall

golden_f1

golden_confusion_matrix
```

---

# 65. Candidate Accuracy

May optionally report:

```text
golden_accuracy
```

as a diagnostic.

Do NOT make it the primary candidate metric.

---

# 66. Candidate Primary Metric

Freeze project emphasis:

```text
PR-AUC
```

as primary ranking metric.

---

# 67. Candidate Recent Metrics

Using the exact same frozen model + preprocessing + threshold:

```text
recent_pr_auc

recent_roc_auc

recent_precision

recent_recall

recent_f1

recent_confusion_matrix
```

when class coverage permits.

---

# 68. No Recent Recalibration

Do NOT recompute:

```text
imputation medians

scaler means/stds

decision threshold
```

from Recent Holdout.

---

# 69. No Golden Recalibration

Same rule.

---

# 70. Candidate Distribution Comparison

Report useful non-training diagnostics:

```text
golden row count

recent row count

golden positive fraction

recent positive fraction

missing-feature fractions
```

---

# 71. Candidate Drift Summary

Compute simple metric deltas such as:

```text
recent_pr_auc - golden_pr_auc

recent_recall - golden_recall

recent_precision - golden_precision
```

Do not define promotion behavior yet.

Phase 6.5 uses evaluation evidence.

---

# 72. Do Not Tune From Drift

A weak Recent Holdout result:

```text
does not trigger retraining automatically
```

in Phase 6.4.

It is evaluation evidence only.

---

# 73. Candidate Probability Integrity

Verify all:

```text
0 <= probability <= 1
```

---

# 74. Candidate Feature Runtime Integrity

Evaluation must use:

```text
exact preprocessing.json

exact feature order

exact native model
```

from the training run.

Do not recompute preprocessing.

---

# 75. Candidate Model Version Check

Expected:

```text
candidate-tabular-mlp-v1
```

or another explicitly supported model version.

Unknown model version:

```text
fail
```

---

# 76. Candidate Preprocessing Version Check

Expected:

```text
candidate-preprocess-v1
```

or explicit supported version.

---

# 77. Anomaly Golden Evaluation

Anomaly model has no natural POSITIVE/NEGATIVE ground truth.

Therefore Golden Test semantics differ.

---

# 78. Anomaly Golden Base Cohort

Freeze an unseen reference cohort from an explicit committed:

```text
Gold anomaly snapshot
```

using groups:

```text
NOT IN TRAIN
NOT IN VALIDATION
```

for that training run.

---

# 79. Anomaly Golden Selection Policy

Introduce:

```text
anomaly-golden-unseen-v1
```

---

# 80. Anomaly Golden Labels Are Not Required

Do NOT require:

```text
TOI label

candidate training label
```

for anomaly base cohort eligibility.

---

# 81. Anomaly Golden Target Leakage

Same invariant:

```text
Golden anomaly TIC
NOT IN
anomaly TRAIN / VALIDATION TICs
```

---

# 82. Anomaly Threshold Policy

Phase 6.3 deliberately created no final threshold.

Introduce:

```text
anomaly-threshold-validation-p99-v1
```

---

# 83. Anomaly Threshold Source

Compute reconstruction scores for:

```text
VALIDATION
```

using frozen:

```text
anomaly-lightcurve-preprocess-v1

anomaly-lightcurve-autoencoder-v1

reconstruction-mse-v1
```

---

# 84. Anomaly Threshold Formula

Freeze:

```text
threshold =
quantile(
    validation_reconstruction_scores,
    0.99,
    method="linear"
)
```

using NumPy's explicitly documented linear quantile semantics.

---

# 85. Anomaly Alert Rule

Freeze:

```text
alert
iff
anomaly_score >= threshold
```

---

# 86. No Golden Threshold Tuning

Golden reference scores must not influence:

```text
p99 threshold
```

---

# 87. No Recent Threshold Tuning

Recent scores do not influence threshold either.

---

# 88. Anomaly Threshold Is Heuristic

Document clearly:

```text
p99 reconstruction threshold
    =
operational anomaly-evidence threshold
```

not:

```text
scientifically validated anomaly boundary
```

---

# 89. Golden Reference Alert Rate

For unmodified Golden reference rows compute:

```text
golden_reference_alert_rate
```

using frozen validation threshold.

---

# 90. Golden Score Statistics

Record:

```text
golden_score_mean

golden_score_median

golden_score_p95

golden_score_p99

golden_score_max
```

---

# 91. Synthetic Evaluation Purpose

AURORA needs a deterministic mechanical test that the autoencoder responds to
strong out-of-distribution feature perturbations.

This is NOT an astrophysical simulation benchmark.

---

# 92. Synthetic Policy

Introduce:

```text
anomaly-synthetic-standardized-shift-v1
```

---

# 93. Synthetic Inputs Do Not Modify Gold

Synthetic evaluation operates:

```text
in memory
```

after the frozen preprocessing transform.

Do NOT write synthetic values into canonical Gold.

---

# 94. Synthetic Perturbation Space

Apply perturbation in:

```text
standardized model-input space
```

so the shift has clear scale semantics.

---

# 95. Deterministic Feature Selection

For each reference row derive:

```text
feature_index =
uint64(
    first 8 bytes of SHA256(source_product_id)
)
mod
input_dim
```

---

# 96. Synthetic Shift

Create:

```text
x_synthetic = x_reference
```

then:

```text
x_synthetic[feature_index] += 6.0
```

V1 uses one deterministic:

```text
+6 standard-deviation-unit shift
```

per row.

---

# 97. Why Feature-Agnostic Synthetic Injection

This avoids hard-coding assumptions such as:

```text
flux_mad is always the injected anomaly
```

and provides a generic runtime sanity evaluation.

---

# 98. Synthetic Policy Version

Changing:

```text
shift magnitude

number of perturbed features

feature-selection algorithm
```

requires:

```text
anomaly-synthetic-standardized-shift-v2
```

---

# 99. Synthetic Detection Rate

Compute:

```text
golden_synthetic_detection_rate =
fraction(
    synthetic_score >= threshold
)
```

---

# 100. Synthetic Score Statistics

Record:

```text
golden_synthetic_score_mean

golden_synthetic_score_median

golden_synthetic_score_p95
```

---

# 101. Synthetic Score Separation

Record useful diagnostic:

```text
golden_synthetic_median_score
-
golden_reference_median_score
```

or equivalent clearly defined delta.

---

# 102. Synthetic Test Is Mechanical

Do NOT report:

```text
astronomical anomaly accuracy
```

from this synthetic perturbation.

Correct wording:

```text
synthetic perturbation detection rate
```

---

# 103. Anomaly Recent Holdout

Introduce:

```text
anomaly-recent-sector-v1
```

---

# 104. Anomaly Recent Eligibility

Recommended:

```text
sector > training_max_sector

group_key not in TRAIN

group_key not in VALIDATION

group_key not in GOLDEN TEST
```

No label requirement.

---

# 105. Anomaly Recent Reference Metrics

Using unchanged frozen model/threshold report:

```text
recent_reference_alert_rate

recent_score_mean

recent_score_median

recent_score_p95

recent_score_p99

recent_score_max
```

---

# 106. Anomaly Recent Synthetic Test

Apply exact same:

```text
anomaly-synthetic-standardized-shift-v1
```

to Recent Holdout.

Report:

```text
recent_synthetic_detection_rate
```

---

# 107. No Recent Refitting

Do NOT refit autoencoder preprocessing from Recent Holdout.

---

# 108. Score Drift

Report:

```text
recent_reference_alert_rate
-
golden_reference_alert_rate
```

and selected score-distribution differences.

Do not automatically change threshold.

---

# 109. Evaluation Run

Each complete evaluation execution gets:

```text
evaluation_run_id
```

---

# 110. Evaluation Specification

Also compute deterministic:

```text
evaluation_spec_fingerprint
```

---

# 111. Evaluation Run ID vs Spec

Freeze:

```text
evaluation_spec_fingerprint
    =
what was evaluated

evaluation_run_id
    =
one concrete execution
```

Same pattern as training.

---

# 112. Candidate Evaluation Spec

Fingerprint includes:

```text
training_run_id

training-run manifest SHA

model SHA

preprocessing SHA

golden cohort ID

recent cohort ID if present

candidate evaluation policy version

threshold policy version
```

---

# 113. Anomaly Evaluation Spec

Also includes:

```text
score-definition version

anomaly threshold policy

synthetic perturbation policy
```

---

# 114. Evaluation Run Storage

Recommended:

```text
evaluations/
└── runs/
    ├── candidate/
    │   └── <evaluation-run-id>/
    │       ├── threshold.json
    │       ├── metrics.json
    │       └── manifest.json
    │
    └── anomaly/
        └── <evaluation-run-id>/
            ├── threshold.json
            ├── metrics.json
            └── manifest.json
```

---

# 115. No Row-Level Prediction Artifact Yet

Do NOT persist:

```text
one probability/score per Gold row
```

as production predictions.

Phase 6.4 evaluation needs aggregate metrics only.

---

# 116. Threshold Artifact

`threshold.json` should be immutable.

Candidate example fields:

```text
schema_version

task

threshold_policy_version

threshold

selection_source = VALIDATION

training_run_id

split_id

validation_row_count
```

---

# 117. Candidate Threshold Metadata

Also record:

```text
validation_f1

validation_precision

validation_recall
```

at selected threshold.

---

# 118. Anomaly Threshold Metadata

Record:

```text
threshold_policy_version

threshold

quantile = 0.99

quantile_method = linear

selection_source = VALIDATION

validation_score_count

score_definition_version
```

---

# 119. Evaluation Metrics Artifact

Candidate:

```text
golden_*

recent_*
```

Anomaly:

```text
golden_reference_*

golden_synthetic_*

recent_reference_*

recent_synthetic_*
```

---

# 120. Evaluation Manifest Contract

Create:

```text
contracts/data/model-evaluation-v1.md
```

---

# 121. Evaluation Manifest Fields

Conceptual:

```text
schema_version

evaluation_run_id

evaluation_spec_fingerprint

task

training_run_id

training_run_manifest_sha256

model_version

model_sha256

preprocessing_version

preprocessing_sha256

golden_cohort_id

golden_cohort_manifest_sha256

recent_cohort_id

recent_cohort_manifest_sha256

evaluation_policy_version

threshold_policy_version

score_definition_version

synthetic_policy_version

threshold_key

threshold_sha256

metrics_key

metrics_sha256

created_at

completed_at
```

Task-specific optional fields may be null/absent.

---

# 122. Evaluation Manifest Written Last

Required:

```text
load/verify inputs
      |
      v
select threshold using VALIDATION
      |
      v
evaluate GOLDEN
      |
      v
evaluate RECENT if provided
      |
      v
write threshold.json
      |
      v
write metrics.json
      |
      v
verify
      |
      v
write manifest.json
```

---

# 123. Manifest Is Evaluation Commit Marker

Without valid:

```text
manifest.json
```

evaluation run is:

```text
NOT COMMITTED
```

---

# 124. No Evaluation Checkpoint Hierarchy

Do NOT create:

```text
checkpoints/ml-evaluation/
```

in V1.

Evaluation is cheap/rebuildable enough.

Use:

```text
manifest-last immutable run commit
```

---

# 125. Why No Evaluation Checkpoint

If evaluation crashes:

```text
rerun evaluation
```

No model optimization state is lost.

Avoid unnecessary checkpoint state.

---

# 126. Evaluation Artifact Immutability

After manifest commit:

```text
threshold.json

metrics.json

manifest.json
```

are immutable.

---

# 127. Evaluation Does Not Mutate Training Run

Record SHA before evaluation.

After evaluation:

```text
training run artifacts unchanged
```

---

# 128. Evaluation Does Not Mutate Gold

Same invariant.

---

# 129. Evaluation Does Not Mutate Split

Same invariant.

---

# 130. Evaluation Does Not Mutate Cohorts

Golden/Recent cohort manifests are read-only after freeze.

---

# 131. Candidate Evaluation Policy

Introduce:

```text
candidate-evaluation-v1
```

It freezes:

```text
validation-only threshold selection

Golden ranking metrics

Golden threshold metrics

Recent metrics

no benchmark tuning
```

---

# 132. Anomaly Evaluation Policy

Introduce:

```text
anomaly-evaluation-v1
```

It freezes:

```text
validation p99 threshold

Golden reference alert rate

synthetic shift evaluation

Recent reference/synthetic evaluation
```

---

# 133. Candidate Evaluate CLI

Recommended:

```bash
python -m aurora_ml.main evaluate-candidate \
    --training-run-id <run-id> \
    --golden-cohort-id <cohort-id> \
    --recent-cohort-id <cohort-id>
```

`--recent-cohort-id` may be optional.

---

# 134. Candidate Golden-Only Evaluation

Support:

```bash
python -m aurora_ml.main evaluate-candidate \
    --training-run-id <run-id> \
    --golden-cohort-id <cohort-id>
```

A recent cohort may not always exist yet.

---

# 135. Anomaly Evaluate CLI

Recommended:

```bash
python -m aurora_ml.main evaluate-anomaly \
    --training-run-id <run-id> \
    --golden-cohort-id <cohort-id> \
    --recent-cohort-id <cohort-id>
```

---

# 136. Cohort Creation Is Separate

Do not have `evaluate-candidate` silently discover:

```text
latest Gold
```

and invent benchmark membership.

Freeze cohort first.

Then evaluate.

---

# 137. Explicit Benchmark Inputs

Evaluation must log:

```text
training_run_id

golden_cohort_id

recent_cohort_id
```

---

# 138. Golden Contamination Preflight

Before candidate/anomaly evaluation:

```text
golden groups
INTERSECT
TRAIN groups
=
empty
```

and:

```text
golden groups
INTERSECT
VALIDATION groups
=
empty
```

---

# 139. Recent Contamination Preflight

Require:

```text
recent groups
INTERSECT
TRAIN groups
=
empty
```

```text
recent groups
INTERSECT
VALIDATION groups
=
empty
```

```text
recent groups
INTERSECT
GOLDEN groups
=
empty
```

---

# 140. Failure On Contamination

If any intersection exists:

```text
EVALUATION_GROUP_LEAKAGE
```

Do not compute/report final metrics.

---

# 141. No Row-Level Leakage Exception

Do not say:

```text
same TIC but different sector is okay
```

It is not okay.

Target-level grouping remains mandatory.

---

# 142. Golden Cohort Reusability

The same Golden cohort may evaluate many models only when each model passes:

```text
group contamination check
```

---

# 143. Future Model Contaminating Golden

If future model training included a Golden target:

```text
that model cannot use this Golden benchmark
```

Do not hide contamination.

---

# 144. Preferred Future Behavior

After Golden freeze:

```text
future ml-split
```

should explicitly reserve Golden group IDs so this situation does not occur.

---

# 145. Candidate Validation Predictions

Recompute from frozen native model.

Do not use:

```text
old console metrics
```

as threshold-selection input.

---

# 146. Candidate Golden Predictions

Use exact same:

```text
feature order

preprocessing

model
```

No cohort-specific transformations.

---

# 147. Candidate Recent Predictions

Same exact runtime pipeline.

---

# 148. Anomaly Validation Scores

Recompute with:

```text
exact feature order

exact anomaly preprocessing

exact autoencoder

reconstruction-mse-v1
```

---

# 149. No Dataset-Specific Preprocessor

Forbidden:

```text
Golden scaler

Recent scaler
```

There is only:

```text
TRAIN-fitted preprocessing artifact
```

---

# 150. Candidate Metrics Library

Use one explicit implementation such as:

```text
scikit-learn
```

for:

```text
average_precision_score

roc_auc_score

precision_score

recall_score

f1_score

confusion_matrix
```

---

# 151. Freeze PR-AUC Meaning

For AURORA V1:

```text
PR-AUC
=
Average Precision
```

if `average_precision_score` is selected.

Document this rather than ambiguously calling several different integrations
"PR-AUC".

---

# 152. ROC-AUC

Use continuous probabilities.

Do not compute ROC-AUC from binary predictions.

---

# 153. Confusion Matrix Order

Freeze label order:

```text
NEGATIVE = 0
POSITIVE = 1
```

Document matrix interpretation.

---

# 154. Precision Zero-Division

Use an explicit deterministic policy.

Recommended:

```text
zero_division=0
```

for diagnostic threshold metrics.

Document it.

---

# 155. Candidate Golden Missing Class

If Golden cohort somehow contains only one class:

```text
fail benchmark validation
```

Do not report misleading PR/ROC metrics.

---

# 156. Recent Missing Class

Recent Holdout may legitimately be too small.

Set:

```text
recent_status =
INSUFFICIENT_CLASS_COVERAGE
```

and avoid undefined ranking metrics.

---

# 157. No NaN Metrics Without Explanation

Undefined metrics should be:

```text
null + status/reason
```

rather than unexplained:

```text
NaN
```

in durable JSON.

---

# 158. Anomaly Quantile Determinism

Test exact:

```text
np.quantile(
    scores,
    0.99,
    method="linear"
)
```

semantics.

---

# 159. Anomaly Empty Validation

Fail:

```text
NO_VALIDATION_SCORES
```

---

# 160. Anomaly Nonfinite Scores

Any:

```text
NaN

Inf
```

in reconstruction scores is an evaluation integrity error.

---

# 161. Candidate Nonfinite Probabilities

Same rule.

---

# 162. Evaluation Run Errors

Keep compact:

```text
INVALID_TRAINING_RUN

INVALID_EVALUATION_COHORT

EVALUATION_GROUP_LEAKAGE

GOLD_SNAPSHOT_MISMATCH

MODEL_ARTIFACT_INTEGRITY_ERROR

PREPROCESSING_INTEGRITY_ERROR

INSUFFICIENT_CLASS_COVERAGE

NO_VALIDATION_SCORES

NONFINITE_EVALUATION_OUTPUT

EVALUATION_ARTIFACT_CONFLICT
```

---

# 163. Cohort Errors

Useful:

```text
NO_UNSEEN_GROUPS

INSUFFICIENT_GOLDEN_CLASS_COVERAGE

NO_RECENT_GROUPS

INVALID_RECENT_SECTOR_ORDER
```

---

# 164. Golden Cohort Existing Exact Match

If deterministic cohort already exists and matches:

```text
reuse
```

---

# 165. Golden Cohort Conflict

Same deterministic cohort path with incompatible manifest:

```text
EVALUATION_COHORT_CONFLICT
```

No overwrite.

---

# 166. Evaluation Run Is Not Registry Model

Do not create:

```text
models/candidate/<model-id>/

models/anomaly/<model-id>/
```

yet.

---

# 167. No Champion Pointer

Do not update:

```text
models/candidate/champion.json

models/anomaly/champion.json
```

Phase 6.5 owns promotion.

---

# 168. Evaluation Does Not Promote

Even excellent Golden metrics:

```text
do not automatically promote
```

in Phase 6.4.

---

# 169. Evaluation Does Not Retrain

Poor Recent Holdout metrics:

```text
do not automatically train a new model
```

---

# 170. No ONNX

Evaluation uses native Phase 6.2/6.3 model.

ONNX export/parity remains Phase 6.6.

---

# 171. No Rust Inference

Do not invoke Rust inference for final parity here.

---

# 172. No Prediction Storage

Do not create:

```text
predictions/
```

---

# 173. No API Changes

Go API does not expose final model evaluations yet.

---

# 174. No Dashboard Changes

React does not display model quality yet.

---

# 175. Candidate Cohort Unit Test

Training exposed:

```text
TIC 1
TIC 2
```

evaluation Gold contains:

```text
TIC 1
TIC 3
TIC 4
```

Expected Golden eligible:

```text
TIC 3
TIC 4
```

Never TIC 1.

---

# 176. Multi-Sector Contamination Test

Training includes:

```text
TIC 123 sector 10
```

evaluation Gold contains:

```text
TIC 123 sector 50
```

Expected:

```text
excluded from Golden and Recent
```

---

# 177. Candidate Golden Class Test

Ensure candidate Golden selection contains both labels.

---

# 178. Candidate Golden Label Preservation

Labels come exactly from:

```text
source Gold snapshot
```

No live relabeling.

---

# 179. Cohort Input Order Test

Shuffle Gold rows.

Expected:

```text
same group list

same cohort ID
```

---

# 180. Cohort Partition Order Test

Shuffle Gold sector read order.

Expected same cohort.

---

# 181. Cohort Timestamp Test

Different `created_at`:

```text
same cohort ID
```

---

# 182. Cohort Gold Change Test

Change source Gold snapshot:

```text
new cohort identity
```

---

# 183. Cohort Policy Change Test

Change:

```text
candidate-golden-unseen-v1
```

to simulated V2:

```text
new cohort identity
```

---

# 184. Golden Immutability Test

Attempt conflicting write.

Expected failure.

---

# 185. Candidate Recent Sector Test

Training max sector:

```text
42
```

Recent source contains:

```text
41
43
44
```

Only:

```text
43
44
```

can qualify before group contamination filtering.

---

# 186. Recent Existing Target Test

Training TIC 9 appears in sector 44.

Expected:

```text
excluded
```

---

# 187. Recent Golden Overlap Test

TIC already in Golden:

```text
excluded from Recent
```

---

# 188. Candidate Threshold Exact Test

Provide deterministic validation probabilities/labels.

Verify exact:

```text
selected threshold
```

under:

```text
max F1
higher recall
higher precision
lower threshold
```

tie semantics.

---

# 189. Candidate Threshold Uses Validation Only

Perturb Golden labels/probabilities.

Expected:

```text
selected threshold unchanged
```

---

# 190. Candidate Threshold Ignores Recent

Same regression.

---

# 191. Candidate Threshold Classification Test

Verify:

```text
probability == threshold
```

is classified:

```text
POSITIVE
```

because rule is `>=`.

---

# 192. Candidate Golden Metric Test

Known probabilities/labels.

Verify:

```text
average precision

ROC-AUC

precision

recall

F1

confusion matrix
```

---

# 193. Candidate Golden Primary Metric Naming

Ensure durable JSON uses explicit:

```text
golden_average_precision
```

or documented equivalent.

Avoid ambiguous unnamed `score`.

---

# 194. Candidate Recent Metric Test

Known recent fixture.

Verify same threshold is reused.

---

# 195. Candidate No Recent Cohort

Golden-only evaluation must still commit successfully.

Manifest records:

```text
recent_cohort_id = null
```

or equivalent.

---

# 196. Candidate Recent Single-Class Test

Expected:

```text
INSUFFICIENT_CLASS_COVERAGE
```

for undefined ranking metrics.

Golden results remain valid.

---

# 197. Candidate Preprocessor Immutability Test

Record:

```text
preprocessing SHA
```

before/after evaluation.

Unchanged.

---

# 198. Candidate Model Immutability Test

Same for:

```text
model.pt
```

---

# 199. Anomaly Threshold Exact Test

Known validation scores.

Verify exact p99 using:

```text
method="linear"
```

---

# 200. Anomaly Threshold Uses Validation Only

Change Golden reference score distribution.

Expected threshold unchanged.

---

# 201. Anomaly Threshold Uses No Recent Data

Same.

---

# 202. Anomaly Alert Boundary Test

Verify:

```text
score == threshold
```

means:

```text
alert = true
```

---

# 203. Synthetic Feature Index Test

Same source product ID + same input dimension:

```text
same perturbed feature index
```

---

# 204. Synthetic Input Order Independence

Synthetic feature selection must not depend on cohort row order.

---

# 205. Synthetic Shift Exactness

Verify:

```text
exactly one feature += 6.0
```

under V1.

---

# 206. Synthetic Gold Immutability Test

Gold values unchanged.

---

# 207. Synthetic Preprocessor Immutability Test

No preprocessing refit.

---

# 208. Synthetic Score Mechanical Test

On deterministic small model/fixture, shifted examples should generally have
higher reconstruction error.

Do not require every single row to increase if model geometry causes an edge
case.

Use aggregate sanity.

---

# 209. Synthetic Detection-Rate Test

Verify:

```text
fraction(score >= threshold)
```

formula.

---

# 210. Anomaly Reference Alert-Rate Test

Verify same formula on unmodified Golden rows.

---

# 211. Anomaly Recent Test

Recent rows use exact frozen:

```text
preprocessing

model

threshold
```

---

# 212. Candidate Contamination Preflight Test

Manually inject one Golden group into TRAIN.

Expected:

```text
EVALUATION_GROUP_LEAKAGE
```

before inference.

---

# 213. Anomaly Contamination Preflight Test

Same.

---

# 214. Recent Contamination Test

Recent group overlaps Golden.

Expected failure or cohort rejection.

---

# 215. Candidate Training Run Integrity Test

Corrupt model artifact.

Evaluation must fail before metric computation.

---

# 216. Candidate Preprocessing Integrity Test

Corrupt preprocessing artifact.

Fail.

---

# 217. Anomaly Model Integrity Test

Same.

---

# 218. Training Run Manifest Corruption

Do not trust evaluation input.

Fail.

---

# 219. Split Manifest Corruption

Fail contamination/membership reconstruction.

---

# 220. Gold Artifact Corruption

Cohort source Gold invalid:

```text
evaluation fails
```

Do not fall back to ClickHouse.

---

# 221. No Bronze Read Integration

Instrument storage across:

```text
cohort creation

threshold selection

Golden evaluation

Recent evaluation
```

Expected:

```text
Bronze reads = 0
```

---

# 222. No Silver Read Integration

Expected:

```text
Silver reads = 0
```

---

# 223. ClickHouse Offline Integration

Stop ClickHouse.

Candidate/anomaly evaluation succeeds.

---

# 224. NATS Offline Integration

Stop NATS.

Evaluation succeeds.

---

# 225. External Network Offline Integration

Disable internet.

Evaluation succeeds.

---

# 226. CPU Evaluation

Mandatory.

Evaluation must work with:

```text
CUDA unavailable
```

---

# 227. GPU Optional

GPU may be used for inference if implementation already supports it cleanly.

Do not require it.

---

# 228. Candidate Full Evaluation Integration

Flow:

```text
completed candidate training run
        |
        v
validation threshold
        |
        v
frozen candidate Golden cohort
        |
        v
Golden metrics
        |
        v
optional Recent cohort
        |
        v
Recent metrics
        |
        v
COMMITTED evaluation run
```

---

# 229. Anomaly Full Evaluation Integration

Flow:

```text
completed anomaly training run
        |
        v
validation p99 threshold
        |
        v
frozen unseen anomaly Golden cohort
        |
        +--> reference scores
        |
        +--> deterministic synthetic shifts
        |
        v
Golden anomaly metrics
        |
        v
optional Recent holdout
        |
        v
COMMITTED evaluation run
```

---

# 230. Evaluation Determinism

Same:

```text
training run
cohorts
policies
runtime
```

should produce:

```text
same threshold

same logical metrics
```

within frozen numerical tolerance.

---

# 231. Evaluation Spec Stability

Same exact inputs:

```text
same evaluation_spec_fingerprint
```

---

# 232. Evaluation Run IDs May Differ

Two executions:

```text
evaluation_run_A
evaluation_run_B
```

may have the same:

```text
evaluation_spec_fingerprint
```

---

# 233. Threshold Policy Change

Simulate candidate threshold V2.

Expected:

```text
new evaluation spec fingerprint
```

---

# 234. Golden Cohort Change

Expected new evaluation specification.

---

# 235. Recent Cohort Change

Expected new evaluation specification.

---

# 236. Operational Config Independence

Change:

```text
log level

MinIO host
```

Expected:

```text
same evaluation_spec_fingerprint
```

---

# 237. Evaluation Artifact SHA

Compute:

```text
threshold_sha256

metrics_sha256
```

and preserve in manifest.

---

# 238. Existing Evaluation Artifact Conflict

Do not silently overwrite a committed evaluation run.

---

# 239. Partial Evaluation

If:

```text
threshold.json

metrics.json
```

exist but:

```text
manifest missing
```

run is uncommitted.

Rerunning or creating a new run is acceptable.

---

# 240. No Complex Evaluation Recovery

Do not add checkpoint machinery to recover a few metric calculations.

---

# 241. Golden Benchmark Documentation

Add:

```text
docs/ML_EVALUATION.md
```

---

# 242. `ML_EVALUATION.md` Candidate Section

Document:

```text
why old TRAIN/VALIDATION cannot become Golden

unseen target requirement

Golden cohort freezing

validation-only threshold selection

PR-AUC / Average Precision

Recent Holdout semantics
```

---

# 243. `ML_EVALUATION.md` Anomaly Section

Document:

```text
validation p99 threshold

reconstruction score meaning

reference alert rate

synthetic standardized shift

why synthetic detection is not astronomy ground truth

Recent score drift
```

---

# 244. Golden Reservation Documentation

Document:

```text
Future training should reserve frozen Golden target groups.
```

If `ml-split-v2` is required, document migration explicitly.

---

# 245. Update ML_DATASETS.md

Add final dataset boundaries:

```text
TRAIN

VALIDATION

GOLDEN TEST

RECENT HOLDOUT
```

and their permitted uses.

---

# 246. Permitted Use Table

Document equivalent:

```text
TRAIN:
    fit weights
    fit preprocessing

VALIDATION:
    early stopping
    threshold selection

GOLDEN TEST:
    final fixed benchmark only

RECENT HOLDOUT:
    freshness / temporal generalization evaluation only
```

---

# 247. Golden Test Cannot Tune Features

Do NOT use Golden metrics to decide:

```text
feature allowlist

model architecture

hyperparameters

preprocessing
```

then continue reporting the same Golden result as untouched final evaluation.

---

# 248. If Golden Influences Development

Once engineers use Golden outcomes to redesign a model:

```text
Golden V1 is now development-visible
```

For rigorous final reporting, freeze:

```text
Golden V2
```

from previously unseen groups.

Document this limitation.

---

# 249. This Is Especially Important For Coursework

Do not repeatedly optimize against the same held-out benchmark while still
calling it:

```text
untouched test set
```

Keep experiment reporting honest.

---

# 250. Update ML_TRAINING.md

Cross-reference:

```text
Phase 6.2/6.3 VALIDATION metrics
    !=
Phase 6.4 Golden metrics
```

---

# 251. Update CONFIGURATION.md

Only add real evaluation configuration.

Prefer explicit CLI inputs for:

```text
cohort IDs

training run IDs
```

Threshold policy constants should normally be versioned in code/contract, not
environment variables.

---

# 252. No `AURORA_GOLDEN_THRESHOLD`

Do not hide scientific evaluation policy in a mutable deployment environment
variable.

---

# 253. Python Ownership

Evaluation logic belongs in existing:

```text
aurora_ml/evaluate.py
```

This file now gets its intended responsibility.

---

# 254. Keep `evaluate.py` Focused

Responsibilities:

```text
cohort validation

contamination checks

threshold selection

candidate metrics

anomaly metrics

evaluation run materialization
```

---

# 255. Split/Cohort Selection Ownership

Group key generation remains in:

```text
splits.py
```

Do not duplicate target-group semantics in `evaluate.py`.

---

# 256. Candidate Model Inference Ownership

Reuse:

```text
transit/model.py
transit/train.py preprocessing definitions/artifacts
```

Do not rewrite model math.

---

# 257. Anomaly Score Ownership

Reuse the exact:

```text
reconstruction-mse-v1
```

function or one canonical implementation.

Do not create a second slightly different MSE formula in evaluation code.

---

# 258. No Global `utils.py`

Keep threshold/metric code under evaluation ownership.

---

# 259. Expected Python Tree

Likely unchanged structurally:

```text
aurora_ml/
├── evaluate.py
├── splits.py
├── transit/
│   ├── model.py
│   └── train.py
└── anomaly/
    ├── model.py
    └── train.py
```

Do not add an `evaluation/` package unless `evaluate.py` genuinely becomes too
large.

---

# 260. Suggested Tests

Expand:

```text
tests/
├── test_evaluate.py
├── test_splits.py
├── test_candidate_training.py
└── test_anomaly_training.py
```

One new:

```text
test_evaluate.py
```

is enough initially.

---

# 261. No New E2E Script Yet

Full Stage 6 orchestration belongs to:

```text
Phase 6.7
```

Use Python integration tests here.

---

# 262. Contracts After Phase

Expected new contracts:

```text
contracts/data/
├── ml-evaluation-cohort-v1.md
└── model-evaluation-v1.md
```

Potential:

```text
ml-split-v2.md
```

ONLY if frozen Golden reservation cannot be represented compatibly by current
split contract.

---

# 263. Do Not Add Model Manifest Yet

Still defer:

```text
model-manifest-v1.md
```

to Phase 6.5.

---

# 264. Do Not Add Runtime Contract Yet

Still defer:

```text
model-runtime-v1.md
```

to Phase 6.6.

---

# 265. Evaluation Lineage

Candidate final evaluation must trace:

```text
evaluation run
      |
      v
training run
      |
      v
model + preprocessing
      |
      v
Gold training snapshot
      |
      v
split
```

and separately:

```text
evaluation run
      |
      +--> Golden cohort
      |       |
      |       v
      |   Golden Gold snapshot
      |
      +--> Recent cohort
              |
              v
          Recent Gold snapshot
```

---

# 266. Candidate Threshold Provenance

Must answer:

```text
Where did this threshold come from?
```

Trace:

```text
candidate threshold
       |
       v
VALIDATION probabilities
       |
       v
exact training split
       |
       v
training model
```

Never Golden.

---

# 267. Anomaly Threshold Provenance

Trace:

```text
anomaly threshold
       |
       v
VALIDATION reconstruction scores
       |
       v
p99 linear quantile
       |
       v
training model/preprocessing
```

---

# 268. Phase 6.5 Handoff

Phase 6.5 should receive:

```text
completed training run
+
completed Phase 6.4 evaluation run
```

before considering model registry promotion.

---

# 269. Registry Must Not Recompute Metrics

Phase 6.5 should consume immutable:

```text
model-evaluation-v1
```

rather than rerunning Golden Test inside promotion logic.

---

# 270. Candidate Promotion Evidence Available

After 6.4, registry can later compare:

```text
Golden Average Precision

Golden recall/precision/F1

Recent Average Precision

Recent recall

metric deltas
```

---

# 271. Anomaly Promotion Evidence Available

Later registry can compare:

```text
Golden reference alert rate

Golden synthetic detection rate

Recent reference alert rate

Recent synthetic detection rate
```

plus reconstruction metrics.

---

# 272. No Promotion Criteria Yet

Do not freeze champion/challenger rules in Phase 6.4.

That belongs to Phase 6.5.

---

# 273. Core Invariants

Invariant 1:

```text
Golden Test groups were never exposed to TRAIN or VALIDATION.
```

Invariant 2:

```text
A previously exposed TIC can never become Golden for that training run.
```

Invariant 3:

```text
Different sector does not make an exposed TIC unseen.
```

Invariant 4:

```text
Golden cohorts are immutable.
```

Invariant 5:

```text
Golden labels are pinned to exact Gold snapshot state.
```

Invariant 6:

```text
Golden Test never selects model weights.
```

Invariant 7:

```text
Golden Test never fits preprocessing.
```

Invariant 8:

```text
Golden Test never selects candidate threshold.
```

Invariant 9:

```text
Recent Holdout never selects candidate threshold.
```

Invariant 10:

```text
Candidate threshold is selected from VALIDATION only.
```

Invariant 11:

```text
Anomaly threshold is selected from VALIDATION reconstruction scores only.
```

Invariant 12:

```text
Candidate Golden primary ranking metric is Average Precision / PR-AUC.
```

Invariant 13:

```text
Accuracy is not the sole candidate metric.
```

Invariant 14:

```text
Anomaly reconstruction score is not a probability.
```

Invariant 15:

```text
Synthetic anomaly evaluation is mechanical evidence, not astrophysical ground truth.
```

Invariant 16:

```text
Recent Holdout uses unseen target groups.
```

Invariant 17:

```text
Recent Holdout uses newer-sector data under V1 policy.
```

Invariant 18:

```text
Evaluation never refits preprocessing.
```

Invariant 19:

```text
Evaluation never retrains the model.
```

Invariant 20:

```text
Evaluation performs zero Bronze reads.
```

Invariant 21:

```text
Evaluation performs zero Silver reads.
```

Invariant 22:

```text
ClickHouse is optional.
```

Invariant 23:

```text
Evaluation artifacts are immutable after manifest commit.
```

Invariant 24:

```text
Evaluation does not mutate training-run artifacts.
```

Invariant 25:

```text
Phase 6.4 does not promote models.
```

Invariant 26:

```text
Future training should reserve frozen Golden groups.
```

Invariant 27:

```text
A Golden benchmark that influences model development is no longer an untouched final benchmark.
```

---

# Definition of Done

Phase 6.4 is COMPLETE when:

* [x] Golden Test semantics are explicitly separated from TRAIN/VALIDATION.
* [x] The implementation refuses to retrofit Golden groups from exposed development groups.
* [x] `development_exposed_groups` includes both TRAIN and VALIDATION groups.
* [x] Golden group intersection with TRAIN is empty.
* [x] Golden group intersection with VALIDATION is empty.
* [x] Same-TIC cross-sector contamination is rejected.
* [x] A later sector does not make an already exposed target Golden.
* [x] Candidate Golden source uses an explicit committed Gold snapshot.
* [x] Anomaly Golden source uses an explicit committed Gold snapshot.
* [x] Candidate Recent source uses an explicit committed Gold snapshot.
* [x] Anomaly Recent source uses an explicit committed Gold snapshot.
* [x] No Bronze reads occur.
* [x] No Silver reads occur.
* [x] Evaluation works after Bronze `RAW_DELETED`.
* [x] Evaluation works with ClickHouse offline.
* [x] Evaluation works with NATS offline.
* [x] Evaluation works with Go API offline.
* [x] Evaluation works without dashboard.
* [x] Evaluation works with external network disabled.
* [x] Evaluation works CPU-only.
* [x] No live TIC/TOI/TCE query occurs.
* [x] `ml-evaluation-cohort-v1.md` exists.
* [x] Golden cohort IDs are deterministic.
* [x] Recent cohort IDs are deterministic.
* [x] Cohort IDs do not depend on creation timestamp.
* [x] Cohort manifests reference exact source Gold snapshot IDs.
* [x] Cohort manifests reference source Gold manifest SHA256.
* [x] Cohort manifests reference dataset-view version/fingerprint.
* [x] Cohort manifests reference selection-policy version.
* [x] Cohort group keys are canonically ordered.
* [x] Cohort manifests do not copy Gold feature matrices.
* [x] Golden cohorts are immutable.
* [x] Recent cohorts are immutable per snapshot.
* [x] Existing identical cohort reuse is idempotent.
* [x] Existing conflicting cohort is rejected.
* [x] Candidate Golden selection uses `candidate-golden-unseen-v1`.
* [x] Candidate Golden includes only `POSITIVE`/`NEGATIVE` supervised rows.
* [x] Candidate Golden preserves natural label distribution.
* [x] Candidate Golden has both classes for official binary metrics.
* [x] Previously unresolved but development-unexposed targets may become Golden after versioned relabeling.
* [x] Any target with an exposed supervised row is excluded entirely from Golden.
* [x] Candidate Recent uses `candidate-recent-sector-v1`.
* [x] Candidate Recent requires sector newer than the training cutoff.
* [x] Candidate Recent excludes TRAIN groups.
* [x] Candidate Recent excludes VALIDATION groups.
* [x] Candidate Recent excludes Golden groups.
* [x] Candidate Recent does not reuse an existing TIC merely because it appears in a newer sector.
* [x] Recent single-class state is reported explicitly instead of fabricating ROC/PR metrics.
* [x] Anomaly Golden uses `anomaly-golden-unseen-v1`.
* [x] Anomaly Golden requires no candidate labels.
* [x] Anomaly Golden excludes TRAIN/VALIDATION target groups.
* [x] Anomaly Recent uses `anomaly-recent-sector-v1`.
* [x] Anomaly Recent excludes TRAIN/VALIDATION/Golden groups.
* [x] Future split behavior can reserve frozen Golden groups.
* [x] Existing `ml-split-v1` manifests are never rewritten.
* [x] If Golden reservation requires incompatible split semantics, `ml-split-v2` is introduced rather than silently changing V1.
* [x] Frozen Golden group IDs can be recorded as future split exclusions.
* [x] Candidate training-run manifest integrity is validated.
* [x] Candidate model checksum is validated.
* [x] Candidate preprocessing checksum is validated.
* [x] Candidate split manifest integrity is validated.
* [x] Anomaly training-run manifest integrity is validated.
* [x] Anomaly model checksum is validated.
* [x] Anomaly preprocessing checksum is validated.
* [x] Anomaly split manifest integrity is validated.
* [x] Candidate evaluation never retrains the model.
* [x] Anomaly evaluation never retrains the model.
* [x] Candidate evaluation never refits preprocessing.
* [x] Anomaly evaluation never refits preprocessing.
* [x] Candidate validation probabilities are recomputed from frozen artifacts.
* [x] Candidate threshold policy is versioned.
* [x] `candidate-threshold-max-f1-v1` exists.
* [x] Candidate threshold uses VALIDATION only.
* [x] Candidate Golden data does not influence threshold.
* [x] Candidate Recent data does not influence threshold.
* [x] Candidate classification uses `probability >= threshold`.
* [x] Candidate threshold maximizes validation F1.
* [x] Candidate threshold tie-break semantics are deterministic.
* [x] Tie break prefers higher recall, then precision, then lower threshold.
* [x] Candidate threshold value is persisted.
* [x] Candidate validation threshold-selection metrics are persisted.
* [x] Candidate Golden Average Precision is computed.
* [x] Candidate Golden ROC-AUC is computed.
* [x] Candidate Golden precision is computed at frozen threshold.
* [x] Candidate Golden recall is computed at frozen threshold.
* [x] Candidate Golden F1 is computed at frozen threshold.
* [x] Candidate Golden confusion matrix is computed.
* [x] Average Precision / PR-AUC is the primary candidate ranking metric.
* [x] Accuracy is not the sole/primary candidate metric.
* [x] Candidate Recent uses the exact same frozen model.
* [x] Candidate Recent uses the exact same preprocessing.
* [x] Candidate Recent uses the exact same decision threshold.
* [x] Candidate Recent ranking metrics are computed when class coverage permits.
* [x] Candidate Recent threshold metrics are computed when class coverage permits.
* [x] Candidate Recent vs Golden metric deltas are recorded.
* [x] Candidate recent metrics do not trigger retraining automatically.
* [x] Candidate probabilities are finite and within `[0,1]`.
* [x] Candidate unknown model/preprocessing versions fail clearly.
* [x] `anomaly-threshold-validation-p99-v1` exists.
* [x] Anomaly validation scores are recomputed using frozen artifacts.
* [x] Anomaly threshold uses validation reconstruction scores only.
* [x] Anomaly p99 uses explicitly documented linear quantile semantics.
* [x] Anomaly alert rule uses `score >= threshold`.
* [x] Anomaly threshold is documented as heuristic evidence threshold.
* [x] Anomaly Golden data does not influence threshold.
* [x] Anomaly Recent data does not influence threshold.
* [x] Golden reference alert rate is computed.
* [x] Golden reference score mean is computed.
* [x] Golden reference score median is computed.
* [x] Golden reference score p95 is computed.
* [x] Golden reference score p99 is computed.
* [x] Golden reference score max is computed.
* [x] `anomaly-synthetic-standardized-shift-v1` exists.
* [x] Synthetic perturbation occurs only in memory.
* [x] Synthetic perturbation occurs after frozen preprocessing.
* [x] Synthetic perturbation does not mutate Gold.
* [x] Synthetic feature index is deterministic from source-product identity.
* [x] Synthetic feature index is independent of row ordering.
* [x] V1 synthetic perturbation changes exactly one standardized feature.
* [x] V1 synthetic shift magnitude is exactly documented.
* [x] Golden synthetic detection rate is computed.
* [x] Golden synthetic score statistics are computed.
* [x] Synthetic/reference score separation diagnostic is computed.
* [x] Synthetic results are not called astrophysical anomaly accuracy.
* [x] Anomaly Recent uses exact same model/preprocessing/threshold.
* [x] Recent anomaly reference alert rate is computed.
* [x] Recent anomaly score distribution is computed.
* [x] Recent synthetic detection rate is computed.
* [x] Recent vs Golden anomaly drift diagnostics are computed.
* [x] No anomaly probability is claimed.
* [x] No anomaly threshold is tuned from Golden/Recent.
* [x] Candidate evaluation policy is versioned.
* [x] `candidate-evaluation-v1` exists.
* [x] Anomaly evaluation policy is versioned.
* [x] `anomaly-evaluation-v1` exists.
* [x] Each concrete evaluation has `evaluation_run_id`.
* [x] Evaluation run ID is distinct from deterministic evaluation-spec fingerprint.
* [x] Evaluation-spec fingerprint includes exact training run.
* [x] Evaluation-spec fingerprint includes exact model/preprocessing hashes.
* [x] Evaluation-spec fingerprint includes Golden cohort ID.
* [x] Evaluation-spec fingerprint includes Recent cohort ID when present.
* [x] Evaluation-spec fingerprint includes evaluation policy.
* [x] Evaluation-spec fingerprint includes threshold policy.
* [x] Anomaly evaluation spec includes score-definition version.
* [x] Anomaly evaluation spec includes synthetic-policy version.
* [x] Operational logging/storage settings do not alter evaluation-spec fingerprint.
* [x] Candidate evaluation artifacts live under `evaluations/runs/candidate/`.
* [x] Anomaly evaluation artifacts live under `evaluations/runs/anomaly/`.
* [x] `threshold.json` is persisted.
* [x] `metrics.json` is persisted.
* [x] Threshold artifact SHA256 is persisted.
* [x] Metrics artifact SHA256 is persisted.
* [x] Evaluation manifest is persisted.
* [x] `model-evaluation-v1.md` exists.
* [x] Evaluation manifest references exact training-run manifest SHA.
* [x] Evaluation manifest references exact model SHA.
* [x] Evaluation manifest references exact preprocessing SHA.
* [x] Evaluation manifest references exact Golden cohort.
* [x] Evaluation manifest references Recent cohort when used.
* [x] Evaluation manifest references threshold artifact.
* [x] Evaluation manifest references metrics artifact.
* [x] Evaluation manifest is written last.
* [x] Evaluation manifest is the run commit marker.
* [x] Evaluation artifacts are immutable after commit.
* [x] Partial evaluation artifacts without manifest are not a committed evaluation run.
* [x] No `checkpoints/ml-evaluation/` hierarchy is introduced.
* [x] Candidate Golden contamination test passes.
* [x] Anomaly Golden contamination test passes.
* [x] Recent-vs-development contamination test passes.
* [x] Recent-vs-Golden contamination test passes.
* [x] Multi-sector target leakage test passes.
* [x] Candidate cohort determinism tests pass.
* [x] Candidate cohort Gold-change identity test passes.
* [x] Candidate Golden class-coverage test passes.
* [x] Candidate Recent-sector test passes.
* [x] Candidate threshold exact-selection test passes.
* [x] Candidate threshold Golden-independence test passes.
* [x] Candidate threshold Recent-independence test passes.
* [x] Candidate threshold equality-boundary test passes.
* [x] Candidate Golden metric tests pass.
* [x] Candidate Recent metric tests pass.
* [x] Candidate Golden-only evaluation works without Recent cohort.
* [x] Candidate Recent single-class handling test passes.
* [x] Candidate model/preprocessing immutability tests pass.
* [x] Anomaly p99 threshold exactness test passes.
* [x] Anomaly threshold Golden-independence test passes.
* [x] Anomaly threshold Recent-independence test passes.
* [x] Anomaly alert-boundary test passes.
* [x] Synthetic feature-index determinism test passes.
* [x] Synthetic shift exactness test passes.
* [x] Synthetic Gold immutability test passes.
* [x] Synthetic detection-rate test passes.
* [x] Anomaly reference alert-rate test passes.
* [x] Anomaly Recent evaluation test passes.
* [x] Corrupt training model prevents evaluation.
* [x] Corrupt preprocessing prevents evaluation.
* [x] Corrupt training manifest prevents evaluation.
* [x] Corrupt split manifest prevents evaluation.
* [x] Corrupt cohort Gold prevents evaluation.
* [x] Full candidate evaluation integration test passes.
* [x] Full anomaly evaluation integration test passes.
* [x] RAW_DELETED evaluation integration test passes.
* [x] Evaluation performs zero Bronze reads.
* [x] Evaluation performs zero Silver reads.
* [x] ClickHouse-offline evaluation test passes.
* [x] NATS-offline evaluation test passes.
* [x] network-offline evaluation test passes.
* [x] CPU-only evaluation test passes.
* [x] Same evaluation specification produces reproducible logical metrics.
* [x] Same evaluation specification produces same spec fingerprint.
* [x] Different threshold policy changes evaluation specification.
* [x] Different Golden cohort changes evaluation specification.
* [x] Different Recent cohort changes evaluation specification.
* [x] No training-run artifact is mutated.
* [x] No Gold artifact is mutated.
* [x] No split manifest is mutated.
* [x] No cohort manifest is mutated after freeze.
* [x] No row-level production predictions are persisted.
* [x] No model registry package is created.
* [x] No champion pointer is changed.
* [x] No promotion decision occurs.
* [x] No retraining is triggered automatically.
* [x] No ONNX export occurs.
* [x] Rust inference remains unchanged.
* [x] No prediction NATS event exists.
* [x] No Go API ML endpoint is added.
* [x] No dashboard ML evaluation view is added.
* [x] `docs/ML_EVALUATION.md` exists.
* [x] `docs/ML_EVALUATION.md` explains why TRAIN/VALIDATION cannot later become Golden.
* [x] `docs/ML_EVALUATION.md` documents candidate threshold semantics.
* [x] `docs/ML_EVALUATION.md` documents anomaly p99 threshold semantics.
* [x] `docs/ML_EVALUATION.md` documents synthetic anomaly limitations.
* [x] `docs/ML_EVALUATION.md` documents Recent Holdout semantics.
* [x] `docs/ML_DATASETS.md` documents TRAIN/VALIDATION/GOLDEN/RECENT roles.
* [x] `docs/ML_TRAINING.md` distinguishes development validation from final evaluation.
* [x] `docs/CONFIGURATION.md` contains only implemented evaluation settings.
* [x] Python README reflects final evaluation boundary.
* [x] Contracts README includes evaluation contracts.
* [x] STRUCTURE.md matches actual changes.
* [x] Existing Stage 5 and Phase 6.1–6.3 tests remain green.
* [x] Repository is ready for Phase 6.5.

---

# Out of Scope

Do NOT implement in Phase 6.4:

* model promotion
* champion pointer
* challenger pointer
* rollback
* registry model packaging
* model-manifest-v1
* ONNX export
* model-runtime-v1
* Rust inference parity
* production prediction generation
* prediction storage
* prediction NATS events
* Go API ML endpoints
* dashboard model metrics
* automated retraining
* hyperparameter search
* feature selection from Golden Test
* retraining from Golden Test
* preprocessing refit from Golden Test
* threshold selection from Golden Test
* threshold selection from Recent Holdout
* anomaly probability calibration
* scientific anomaly confirmation
* scientific exoplanet confirmation

---

# Next

```text
Stage 6 — Machine Learning Training, Evaluation & Model Registry

Phase 6.1  ML Dataset View & Deterministic Group Split        [DONE]

Phase 6.2  Candidate Vetting Model Training                   [DONE]

Phase 6.3  Astronomical Anomaly Detection Training            [DONE]

Phase 6.4  Evaluation — Golden Test & Recent Holdout          [DONE]

Phase 6.5  Model Registry — Champion / Challenger,
           Promotion & Rollback
```

```
```
