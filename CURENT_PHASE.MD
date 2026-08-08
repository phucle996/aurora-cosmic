````md id="phase-6-5"
# CHECKLIST_PHASE_6_5.md

# Stage 6 — Machine Learning Training, Evaluation & Model Registry
## Phase 6.5 — Model Registry: Champion / Challenger, Promotion & Rollback

Status: TODO

Goal:

> Turn completed training runs and completed Phase 6.4 evaluation runs into
> immutable registry model packages, then manage which evaluated model is the
> current AURORA champion.
>
> Phase 6.5 introduces:
>
> - immutable registered model packages,
> - deterministic model package identity,
> - explicit challenger semantics,
> - candidate-vetting promotion policy,
> - anomaly-detection promotion policy,
> - immutable promotion/rollback decision records,
> - one small mutable champion pointer per task,
> - safe bootstrap of the first champion,
> - promotion comparison against the current champion,
> - explicit rollback to a previously selected champion.
>
> The registry must preserve:
>
>     Gold snapshot
>         ->
>     split
>         ->
>     training run
>         ->
>     evaluation run
>         ->
>     registered model
>         ->
>     promotion decision
>         ->
>     champion pointer
>
> Important:
>
>     "Champion" in Phase 6.5 means:
>
>         evaluation-selected registry champion.
>
> It does NOT yet mean:
>
>         successfully exported ONNX,
>         Rust-runtime validated,
>         deployed to production inference.
>
> Runtime packaging/parity belongs to Phase 6.6.
>
> Do NOT export ONNX yet.
> Do NOT modify Rust inference yet.
> Do NOT retrain during promotion.
> Do NOT overwrite old models during rollback.

---

# 1. Registry Input Boundary

A model may enter the registry only from a valid:

```text
COMPLETED training run
````

under:

```text id="reg01"
training-runs/candidate/<training-run-id>/
```

or:

```text id="reg02"
training-runs/anomaly/<training-run-id>/
```

---

# 2. Promotion Input Boundary

A registered model may become champion only with a valid:

```text id="reg03"
COMPLETED Phase 6.4 evaluation run
```

that evaluates the exact training/model artifacts being promoted.

---

# 3. Registry Does Not Train

Phase 6.5 must never call:

```text id="reg04"
optimizer.step()
```

or:

```text id="reg05"
fit preprocessing
```

Registry operations consume immutable completed artifacts.

---

# 4. Registry Does Not Evaluate Science Again

Promotion must consume:

```text id="reg06"
model-evaluation-v1
```

artifacts.

Do NOT rerun:

```text id="reg07"
Golden Test

Recent Holdout
```

inside registry comparison logic.

---

# 5. Canonical Registry Storage

Use existing permanent:

```text id="reg08"
models/
```

prefix.

Recommended layout:

```text id="reg09"
models/
├── candidate/
│   ├── <model-id>/
│   │   ├── manifest.json
│   │   ├── model.pt
│   │   └── preprocessing.json
│   │
│   ├── decisions/
│   │   └── <decision-id>.json
│   │
│   └── champion.json
│
└── anomaly/
    ├── <model-id>/
    │   ├── manifest.json
    │   ├── model.pt
    │   └── preprocessing.json
    │
    ├── decisions/
    │   └── <decision-id>.json
    │
    └── champion.json
```

---

# 6. Threshold Is Not Copied Into Model Package

Important separation:

```text id="reg10"
model package
    =
trained model
+
TRAIN-fitted preprocessing
```

The Phase 6.4 threshold belongs to:

```text id="reg11"
evaluation / selection evidence
```

and is referenced by the champion selection.

---

# 7. Why Threshold Is Separate

The same trained model may later be:

```text id="reg12"
re-evaluated

compared on a new Golden cohort

compared under a new evaluation policy
```

without changing:

```text id="reg13"
model.pt

preprocessing.json

model_id
```

---

# 8. Phase 6.6 Runtime Package

Later Phase 6.6 will combine:

```text id="reg14"
champion model
+
champion preprocessing
+
champion evaluation threshold
+
ONNX
```

into a separate immutable runtime package.

Do NOT mutate the Phase 6.5 model package to add ONNX later.

---

# 9. Model Package Is Immutable

Once:

```text id="reg15"
models/<task>/<model-id>/manifest.json
```

is committed:

```text id="reg16"
model.pt

preprocessing.json

manifest.json
```

must never change.

---

# 10. Model Package Source

Registry copies exact verified bytes from:

```text id="reg17"
training-runs/<task>/<training-run-id>/model.pt
```

and:

```text id="reg18"
training-runs/<task>/<training-run-id>/preprocessing.json
```

---

# 11. Why Copy Into Registry

Registry model packages should remain self-contained for future:

```text id="reg19"
rollback

runtime export

integrity verification
```

without treating temporary training-run layout as the serving package.

---

# 12. Do Not Copy Development Metrics Into Runtime Package

Do not duplicate:

```text id="reg20"
metrics.json
```

just to make the model directory larger.

Registry manifest references:

```text id="reg21"
training run
```

and promotion decisions reference:

```text id="reg22"
evaluation run
```

---

# 13. Model Manifest Contract

Create:

```text id="reg23"
contracts/data/model-manifest-v1.md
```

---

# 14. Model Manifest Meaning

`model-manifest-v1` describes:

```text id="reg24"
one immutable trained model package
```

It does NOT describe:

```text id="reg25"
champion mutable state

ONNX runtime package

prediction output
```

---

# 15. Registry Tasks

V1 task families:

```text id="reg26"
candidate_vetting

astronomical_anomaly_detection
```

Registry path names may remain compact:

```text id="reg27"
candidate

anomaly
```

---

# 16. Candidate Registered Model

Expected model version:

```text id="reg28"
candidate-tabular-mlp-v1
```

with preprocessing:

```text id="reg29"
candidate-preprocess-v1
```

---

# 17. Anomaly Registered Model

Expected model version:

```text id="reg30"
anomaly-lightcurve-autoencoder-v1
```

with preprocessing:

```text id="reg31"
anomaly-lightcurve-preprocess-v1
```

---

# 18. Unknown Model Version

Do not register an unsupported:

```text id="reg32"
model_version
```

without explicit registry compatibility.

Fail clearly.

---

# 19. Training Run Verification

Before registration verify:

```text id="reg33"
training run manifest exists

manifest schema supported

state logically COMPLETED

model object exists

model SHA matches

preprocessing object exists

preprocessing SHA matches
```

---

# 20. Gold Provenance Verification

Registry should also validate manifest-level references:

```text id="reg34"
gold_snapshot_id

gold_manifest_sha256

split_id

split_manifest_sha256

dataset_view_version

dataset_view_fingerprint
```

---

# 21. No Gold Feature Re-read Required

Registration does NOT need to read every Gold row again.

The completed training-run provenance is sufficient after integrity validation.

---

# 22. No Bronze Read

Expected:

```text id="reg35"
Bronze reads = 0
```

---

# 23. No Silver Read

Expected:

```text id="reg36"
Silver reads = 0
```

---

# 24. No ClickHouse Requirement

Registry must work when:

```text id="reg37"
ClickHouse unavailable
```

---

# 25. No External Catalog Requirement

No:

```text id="reg38"
TIC

TOI

TCE
```

network access.

---

# 26. No NATS Requirement

Promotion/rollback are explicit registry operations.

Do not add registry events in Phase 6.5.

---

# 27. Model Package Fingerprint

Compute deterministic:

```text id="reg39"
model_fingerprint =
SHA256(
    task
    +
    training_run_id
    +
    training_run_manifest_sha256
    +
    model_version
    +
    model_sha256
    +
    preprocessing_version
    +
    preprocessing_sha256
    +
    dataset_view_version
    +
    dataset_view_fingerprint
    +
    exact feature order
)
```

using canonical serialization.

---

# 28. Model ID

Recommended:

```text id="reg40"
model-v1-<sha-prefix>
```

Persist full:

```text id="reg41"
model_fingerprint
```

inside manifest.

---

# 29. Model ID Is Deterministic

Same exact:

```text id="reg42"
training artifact

preprocessing artifact

provenance

feature contract
```

produces the same:

```text id="reg43"
model_id
```

---

# 30. Model ID Does Not Depend On Evaluation

Important:

```text id="reg44"
evaluation_run_id
```

does NOT participate in model identity.

A model may be evaluated multiple times without changing model bytes or
registry model ID.

---

# 31. Model ID Does Not Depend On Time

Do NOT include:

```text id="reg45"
registered_at

hostname

random UUID
```

in fingerprint.

---

# 32. Model ID Does Not Depend On Device Metadata

Training runtime/device information is preserved in the source training run.

Do not make:

```text id="reg46"
CPU vs CUDA label
```

itself alter registry identity if resulting registered artifacts/provenance are
otherwise the exact defined package.

---

# 33. Model Manifest Fields

Conceptual:

```text id="reg47"
schema_version

model_id

model_fingerprint

task

model_version

training_run_id

training_run_manifest_key

training_run_manifest_sha256

gold_snapshot_id

split_id

dataset_view_version

dataset_view_fingerprint

feature_names

preprocessing_version

model_key

model_sha256

preprocessing_key

preprocessing_sha256

registered_at

producer
```

---

# 34. `registered_at` Is Metadata Only

It must not affect:

```text id="reg48"
model_fingerprint
```

---

# 35. Feature Order Is Persisted

Registry model manifest must retain exact:

```text id="reg49"
feature_names
```

ordering.

Later ONNX/Rust runtime must use exactly this order.

---

# 36. Candidate Output Semantics

Candidate manifest records output meaning:

```text id="reg50"
one binary logit
```

if useful.

Do not call it:

```text id="reg51"
planet confirmation probability
```

---

# 37. Anomaly Output Semantics

Anomaly manifest records:

```text id="reg52"
reconstruction vector
```

and model family.

The anomaly score remains defined by:

```text id="reg53"
reconstruction-mse-v1
```

through evaluation/runtime policy.

---

# 38. Registration Ordering

Required:

```text id="reg54"
verify training run
      |
      v
compute model ID
      |
      v
copy model.pt
      |
      v
verify copied model
      |
      v
copy preprocessing.json
      |
      v
verify copied preprocessing
      |
      v
write model manifest LAST
      |
      v
verify manifest
```

---

# 39. Model Manifest Is Package Commit Marker

If:

```text id="reg55"
model.pt exists
preprocessing.json exists
manifest missing
```

the registry package is:

```text id="reg56"
NOT COMMITTED
```

---

# 40. Existing Exact Package

If deterministic model path already exists and all:

```text id="reg57"
hashes

provenance

feature order
```

match:

```text id="reg58"
registration is idempotent no-op
```

---

# 41. Existing Model Conflict

Same deterministic:

```text id="reg59"
model_id
```

but different package content:

```text id="reg60"
MODEL_REGISTRY_CONFLICT
```

Never overwrite.

---

# 42. No Registered Model Mutation

A new evaluation does NOT modify:

```text id="reg61"
models/<task>/<model-id>/manifest.json
```

---

# 43. No Mutable `status=challenger`

Do NOT write inside model manifest:

```text id="reg62"
status = challenger

status = champion
```

because those states change over time.

Model manifest is immutable.

---

# 44. Challenger Semantics

Freeze:

```text id="reg63"
challenger
=
a valid registered model
that is not the current champion
and is eligible for comparison
```

No separate mutable challenger pointer is required.

---

# 45. Multiple Challengers

Many registered models may coexist:

```text id="reg64"
model-A
model-B
model-C
```

with only one current champion.

This is valid.

---

# 46. Champion Pointer

Use:

```text id="reg65"
models/candidate/champion.json
```

and:

```text id="reg66"
models/anomaly/champion.json
```

---

# 47. Champion Pointer Is Mutable Convenience State

Freeze:

```text id="reg67"
registered model packages
    =
immutable history
```

```text id="reg68"
champion.json
    =
mutable current selection
```

---

# 48. Champion Does Not Mean Deployed

Document prominently:

```text id="reg69"
registry champion
    !=
runtime-deployed model
```

Phase 6.6 still needs:

```text id="reg70"
ONNX export

Python/ONNX parity

Rust parity
```

---

# 49. Champion Pointer Must Carry Evaluation Selection

A champion is not just:

```text id="reg71"
model_id
```

It also needs the exact Phase 6.4 evaluation that supplied:

```text id="reg72"
threshold

promotion evidence
```

---

# 50. Champion Pointer Fields

Conceptual:

```text id="reg73"
schema_version

task

model_id

model_manifest_key

model_manifest_sha256

evaluation_run_id

evaluation_manifest_key

evaluation_manifest_sha256

threshold_key

threshold_sha256

decision_id

decision_key

previous_model_id

updated_at
```

---

# 51. Threshold Must Match Evaluation

Before pointer update verify:

```text id="reg74"
threshold.json
```

belongs to the exact:

```text id="reg75"
evaluation_run_id
```

stored in the pointer.

---

# 52. Evaluation Must Match Model

Verify:

```text id="reg76"
evaluation.training_run_id
==
model.training_run_id
```

and model/preprocessing hashes match the evaluated artifacts.

---

# 53. Model Selection Contract

Create:

```text id="reg77"
contracts/data/model-promotion-v1.md
```

Document:

```text id="reg78"
promotion decision record

bootstrap decision

rollback decision

champion pointer semantics
```

---

# 54. Immutable Decision Records

Use:

```text id="reg79"
models/<task>/decisions/<decision-id>.json
```

---

# 55. Decision Records Are Append-Only

Never mutate an old:

```text id="reg80"
decision-id
```

record.

---

# 56. Decision Record Meaning

A decision record means:

```text id="reg81"
policy comparison / explicit selection decision was made
```

It does NOT by itself prove that:

```text id="reg82"
champion pointer was successfully updated
```

The pointer is the current-state truth.

---

# 57. Why Decision Before Pointer

Ordering:

```text id="reg83"
immutable decision
      |
      v
mutable champion pointer
```

allows crash-safe recovery.

---

# 58. Decision Actions

V1:

```text id="reg84"
BOOTSTRAP

PROMOTE

ROLLBACK
```

---

# 59. Decision Outcome

Promotion comparison records:

```text id="reg85"
PASS

FAIL
```

Rollback/Bootstrap valid operations produce:

```text id="reg86"
PASS
```

after preflight succeeds.

---

# 60. Failed Promotion Is Preserved

A challenger that fails promotion policy should still produce an immutable:

```text id="reg87"
FAIL decision record
```

for audit.

Champion pointer remains unchanged.

---

# 61. Promotion Decision Fields

Conceptual:

```text id="reg88"
schema_version

decision_id

decision_fingerprint

task

action

outcome

policy_version

expected_current_model_id

expected_current_decision_id

challenger_model_id

challenger_model_manifest_sha256

challenger_evaluation_run_id

challenger_evaluation_manifest_sha256

incumbent_model_id

incumbent_evaluation_run_id

selected_model_id

selected_evaluation_run_id

metric_comparison

guardrails

reason_codes

created_at

producer
```

---

# 62. Rollback Decision Fields

Also include:

```text id="reg89"
rollback_target_decision_id

rollback_reason
```

---

# 63. Decision Fingerprint

Compute deterministic SHA256 over:

```text id="reg90"
task

action

policy version

expected current champion selection

challenger / target model

evaluation IDs

comparison inputs

rollback reason where applicable
```

Exclude:

```text id="reg91"
created_at
```

---

# 64. Decision ID

Example:

```text id="reg92"
decision-v1-<sha-prefix>
```

---

# 65. Decision Idempotency

Rerunning the exact same comparison/action should resolve to the same:

```text id="reg93"
decision_id
```

---

# 66. Decision Conflict

Same deterministic decision key with different body:

```text id="reg94"
MODEL_DECISION_CONFLICT
```

No overwrite.

---

# 67. Registration CLI

Add:

```bash id="reg95"
python -m aurora_ml.main register-model \
    --training-run-id <training-run-id>
```

Task is resolved from the training-run manifest.

---

# 68. Register Output

Example:

```text id="reg96"
model_id:            model-v1-...
task:                candidate_vetting
model_version:       candidate-tabular-mlp-v1
training_run_id:     candidate-run-...
state:               REGISTERED
champion:            false
```

---

# 69. Registration Does Not Promote

Mandatory:

```text id="reg97"
register-model
```

must NOT change:

```text id="reg98"
champion.json
```

---

# 70. Comparison CLI

Useful:

```bash id="reg99"
python -m aurora_ml.main compare-model \
    --model-id <challenger-model-id> \
    --evaluation-run-id <challenger-evaluation-run-id>
```

This performs a dry comparison against current champion.

No pointer mutation.

---

# 71. Promotion CLI

Use:

```bash id="reg100"
python -m aurora_ml.main promote-model \
    --model-id <challenger-model-id> \
    --evaluation-run-id <challenger-evaluation-run-id>
```

---

# 72. Optional Incumbent Evaluation Override

Support:

```text id="reg101"
--incumbent-evaluation-run-id <evaluation-run-id>
```

when the current champion has been re-evaluated on the same newer Golden
cohort as the challenger.

---

# 73. Why Incumbent Evaluation Override

Current champion pointer may reference:

```text id="reg102"
Golden cohort V1
```

while challenger was evaluated on:

```text id="reg103"
Golden cohort V2
```

For fair comparison:

```text id="reg104"
re-evaluate incumbent on V2
```

then pass that evaluation explicitly.

Do not compare incompatible cohorts.

---

# 74. Champion Pointer Is Not Rewritten Just For Re-Evaluation

Re-evaluating the current champion does not by itself change:

```text id="reg105"
champion.json
```

Selection state changes only through an explicit selection action.

---

# 75. Promotion Preflight

Before comparison verify:

```text id="reg106"
challenger model package valid

challenger evaluation valid

evaluation references challenger training/model artifacts

current champion pointer valid

current champion model package valid

incumbent evaluation valid

tasks match
```

---

# 76. Promotion Requires Registered Challenger

Do NOT promote directly from:

```text id="reg107"
training-runs/
```

The challenger must first have a committed:

```text id="reg108"
model-manifest-v1
```

---

# 77. Current Champion Integrity

Before replacing champion verify:

```text id="reg109"
champion pointer

champion model manifest

champion model artifact

champion preprocessing

champion evaluation

champion threshold
```

are all internally consistent.

---

# 78. Corrupt Current Champion

If current champion artifacts are corrupt:

```text id="reg110"
do not pretend normal model comparison is valid
```

Surface:

```text id="reg111"
CHAMPION_INTEGRITY_ERROR
```

Operator may use explicit rollback to a known-valid previous champion after
investigation.

---

# 79. Task Must Match

Candidate model can never become:

```text id="reg112"
anomaly champion
```

and anomaly model can never become:

```text id="reg113"
candidate champion
```

---

# 80. Evaluation Must Be Completed

Promotion requires:

```text id="reg114"
valid evaluation manifest
```

not merely:

```text id="reg115"
metrics.json
```

---

# 81. Evaluation Cohort Compatibility

Head-to-head promotion requires the same:

```text id="reg116"
Golden cohort ID
```

for challenger and incumbent comparison.

---

# 82. No Different-Golden Comparison

Forbidden:

```text id="reg117"
challenger on Golden A
vs
champion on Golden B
```

Return:

```text id="reg118"
INCOMPARABLE_EVALUATIONS
```

---

# 83. Evaluation Policy Compatibility

V1 comparison also requires same:

```text id="reg119"
evaluation_policy_version

threshold_policy_version
```

---

# 84. Candidate View Compatibility

For:

```text id="reg120"
candidate-promotion-v1
```

require same:

```text id="reg121"
dataset_view_version

dataset_view_fingerprint
```

between challenger and incumbent.

---

# 85. Why Same View In V1

This keeps comparison focused on:

```text id="reg122"
model/training improvements
```

rather than silently mixing incompatible feature semantics.

---

# 86. Cross-View Promotion

A future feature-set change may require:

```text id="reg123"
candidate-promotion-v2
```

with explicit cross-view comparison semantics.

Do not silently allow it under V1.

---

# 87. Anomaly View Compatibility

For:

```text id="reg124"
anomaly-promotion-v1
```

require same:

```text id="reg125"
anomaly dataset view

score definition

synthetic evaluation policy
```

---

# 88. Recent Holdout Compatibility

If both evaluations have a Recent Holdout:

```text id="reg126"
recent_cohort_id must match
```

---

# 89. One Recent, One Missing

If:

```text id="reg127"
challenger has Recent
champion does not
```

or inverse:

```text id="reg128"
INCOMPARABLE_RECENT_EVALUATION
```

for V1 promotion.

---

# 90. Both Without Recent

Promotion may proceed using:

```text id="reg129"
Golden evidence only
```

if all other comparability rules pass.

---

# 91. Recent Insufficient Class Coverage

Candidate evaluation may report:

```text id="reg130"
INSUFFICIENT_CLASS_COVERAGE
```

for the same Recent cohort.

If both evaluations share that state:

```text id="reg131"
recent candidate guardrail = NOT_APPLICABLE
```

and record why.

---

# 92. Promotion Policy: Candidate

Introduce:

```text id="reg132"
candidate-promotion-v1
```

---

# 93. Candidate Primary Metric

Use:

```text id="reg133"
Golden Average Precision
```

from Phase 6.4.

---

# 94. Candidate Primary Requirement

Freeze:

```text id="reg134"
challenger.golden_average_precision
>
incumbent.golden_average_precision
```

with numerical comparison epsilon:

```text id="reg135"
1e-12
```

---

# 95. Candidate Golden Recall Guardrail

Require:

```text id="reg136"
challenger.golden_recall
>=
incumbent.golden_recall - 0.02
```

---

# 96. Why Recall Guardrail

A ranking metric improvement should not come with a large drop in:

```text id="reg137"
candidate recovery / sensitivity
```

under the validation-selected threshold.

---

# 97. Candidate Recent AP Guardrail

When comparable Recent metrics exist:

```text id="reg138"
challenger.recent_average_precision
>=
incumbent.recent_average_precision - 0.02
```

---

# 98. Candidate Recent Recall Guardrail

When comparable Recent metrics exist:

```text id="reg139"
challenger.recent_recall
>=
incumbent.recent_recall - 0.03
```

---

# 99. Candidate Promotion Pass

V1 passes only when:

```text id="reg140"
Golden AP improves
AND
Golden recall guardrail passes
AND
all applicable Recent guardrails pass
```

---

# 100. Candidate Policy Is Project Policy

These tolerances are:

```text id="reg141"
engineering promotion guardrails
```

not universal astronomical laws.

Document them exactly.

---

# 101. Candidate Policy Change

Any change to:

```text id="reg142"
primary metric

comparison direction

recall tolerance

Recent tolerances
```

requires:

```text id="reg143"
candidate-promotion-v2
```

---

# 102. No Accuracy Promotion Criterion

Do not promote primarily because:

```text id="reg144"
accuracy increased
```

---

# 103. No Training-Loss Promotion Criterion

Do not promote because:

```text id="reg145"
training loss is smaller
```

---

# 104. No Validation-Only Promotion

Do not select champion based only on:

```text id="reg146"
Phase 6.2 VALIDATION
```

Champion selection requires Phase 6.4 final evaluation evidence.

---

# 105. Promotion Policy: Anomaly

Introduce:

```text id="reg147"
anomaly-promotion-v1
```

---

# 106. Anomaly Comparable Metrics

Use Phase 6.4:

```text id="reg148"
Golden synthetic detection rate

Golden reference alert rate
```

plus comparable Recent metrics where available.

---

# 107. Anomaly Synthetic Guardrail

Require:

```text id="reg149"
challenger.golden_synthetic_detection_rate
>=
incumbent.golden_synthetic_detection_rate - 0.02
```

---

# 108. Anomaly Reference Alert Guardrail

Require:

```text id="reg150"
challenger.golden_reference_alert_rate
<=
incumbent.golden_reference_alert_rate + 0.01
```

---

# 109. Anomaly Must Improve Something

In addition to guardrails require at least one strict improvement:

```text id="reg151"
challenger.golden_synthetic_detection_rate
>
incumbent.golden_synthetic_detection_rate + 1e-12
```

OR:

```text id="reg152"
challenger.golden_reference_alert_rate
<
incumbent.golden_reference_alert_rate - 1e-12
```

---

# 110. Anomaly Recent Synthetic Guardrail

When comparable:

```text id="reg153"
challenger.recent_synthetic_detection_rate
>=
incumbent.recent_synthetic_detection_rate - 0.02
```

---

# 111. Anomaly Recent Alert Guardrail

When comparable:

```text id="reg154"
challenger.recent_reference_alert_rate
<=
incumbent.recent_reference_alert_rate + 0.01
```

---

# 112. Anomaly Promotion Pass

V1 passes when:

```text id="reg155"
Golden synthetic guardrail passes
AND
Golden reference-alert guardrail passes
AND
at least one Golden metric strictly improves
AND
all applicable Recent guardrails pass
```

---

# 113. Do Not Compare Raw Reconstruction Loss Across Arbitrary Models

Do not make:

```text id="reg156"
lower validation MSE
```

the registry promotion metric.

Reconstruction losses may change scale/meaning with:

```text id="reg157"
feature view

preprocessing

model semantics
```

Phase 6.4 evaluation metrics are safer.

---

# 114. No "Anomaly Accuracy" Promotion

Do not invent a supervised accuracy criterion for the unsupervised model.

---

# 115. Anomaly Promotion Policy Change

Semantic changes require:

```text id="reg158"
anomaly-promotion-v2
```

---

# 116. Promotion Metric Snapshot

Decision record should persist the exact compared values.

Candidate example:

```text id="reg159"
incumbent_golden_average_precision

challenger_golden_average_precision

incumbent_golden_recall

challenger_golden_recall

incumbent_recent_average_precision

challenger_recent_average_precision
```

---

# 117. Guardrail Results

Persist explicit:

```text id="reg160"
primary_metric_pass

golden_recall_guardrail_pass

recent_ap_guardrail_pass

recent_recall_guardrail_pass
```

or anomaly equivalents.

---

# 118. Human-Readable Reasons

Decision may contain small codes such as:

```text id="reg161"
PRIMARY_METRIC_NOT_IMPROVED

GOLDEN_RECALL_REGRESSION

RECENT_AP_REGRESSION

RECENT_RECALL_REGRESSION
```

---

# 119. Candidate Failure Example

If:

```text id="reg162"
Golden AP improves
```

but:

```text id="reg163"
Golden recall drops 10%
```

promotion:

```text id="reg164"
FAIL
```

---

# 120. Anomaly Failure Example

If synthetic detection improves but:

```text id="reg165"
reference alert rate jumps substantially
```

promotion:

```text id="reg166"
FAIL
```

---

# 121. No Automatic Best-Of-N Search

Registry does not scan every training run and automatically choose the maximum
metric.

Promotion is explicit.

---

# 122. No Hyperparameter Tuning In Registry

Do not make promotion code start new training runs.

---

# 123. Bootstrap First Champion

When:

```text id="reg167"
champion.json
```

does not exist, there is no incumbent for comparison.

---

# 124. Bootstrap Is Explicit

Use:

```bash id="reg168"
python -m aurora_ml.main promote-model \
    --model-id <model-id> \
    --evaluation-run-id <evaluation-run-id> \
    --bootstrap
```

---

# 125. Bootstrap Precondition

Require:

```text id="reg169"
no existing valid champion pointer
```

If champion already exists:

```text id="reg170"
BOOTSTRAP_NOT_ALLOWED
```

---

# 126. Bootstrap Requires Final Evaluation

First champion still requires:

```text id="reg171"
valid Golden Test evaluation
```

Do not bootstrap directly from validation metrics.

---

# 127. Bootstrap Does Not Need Incumbent Metrics

There is nothing to compare against.

Therefore:

```text id="reg172"
candidate-promotion-v1 comparison thresholds
```

do not apply to the first champion.

---

# 128. No Arbitrary Absolute Accuracy Floor V1

Do not invent a universal:

```text id="reg173"
must exceed 90%
```

rule.

Bootstrap requires valid completed evaluation and explicit operator intent.

---

# 129. Bootstrap Decision

Create immutable:

```text id="reg174"
action=BOOTSTRAP

outcome=PASS
```

decision record.

---

# 130. Bootstrap Pointer Update

After decision commit:

```text id="reg175"
champion.json
```

points to:

```text id="reg176"
model

evaluation

threshold

bootstrap decision
```

---

# 131. Promotion Does Not Need `--force`

Do NOT add:

```text id="reg177"
--force
```

to bypass comparison guardrails.

If policy is inappropriate:

```text id="reg178"
version the policy
```

instead.

---

# 132. Dry-Run Comparison

`compare-model` should show:

```text id="reg179"
incumbent

challenger

cohort IDs

metric deltas

guardrail results

PASS / FAIL
```

without modifying champion state.

---

# 133. Promotion Reuses Comparison Logic

`promote-model` must call the same deterministic policy implementation used by
dry comparison.

Do not maintain two promotion formulas.

---

# 134. PASS Decision Before Pointer Mutation

Required order:

```text id="reg180"
verify all inputs
      |
      v
compute decision
      |
      v
write immutable decision record
      |
      v
if FAIL -> stop
      |
      v
re-read current champion
      |
      v
verify expected current champion unchanged
      |
      v
update champion pointer
      |
      v
verify pointer
```

---

# 135. Why Re-read Champion

Another operator may have changed:

```text id="reg181"
champion.json
```

between comparison and pointer write.

V1 does not need a distributed lock, but must not knowingly apply a stale
comparison.

---

# 136. Current Champion Changed

If expected incumbent differs from current pointer:

```text id="reg182"
CHAMPION_CHANGED
```

Do not apply stale promotion.

Re-run comparison.

---

# 137. V1 Concurrency Assumption

Freeze operational constraint:

```text id="reg183"
one intentional registry mutation operation per task at a time
```

No distributed lock service is introduced.

---

# 138. No Redis/Database Lock

Do NOT add:

```text id="reg184"
Redis

PostgreSQL

etcd
```

for registry pointer updates.

---

# 139. Pointer Verification

After PUT verify:

```text id="reg185"
task

model_id

evaluation_run_id

threshold SHA

decision ID
```

match intended selection.

---

# 140. Pointer Write Failure

If immutable PASS decision exists but:

```text id="reg186"
champion pointer PUT fails
```

model selection was not applied.

Existing champion remains authoritative.

---

# 141. Retry After Pointer Failure

Rerun exact operation.

Expected:

```text id="reg187"
same decision ID reused
```

then pointer update retried if current champion is still the expected one.

---

# 142. Crash After Decision Before Pointer

Same recovery behavior.

No need for registry checkpoint.

---

# 143. Crash After Pointer Before Verification

Rerun:

```text id="reg188"
champion pointer already references intended decision
```

Then:

```text id="reg189"
verify and succeed
```

No duplicate model package.

---

# 144. No Registry Checkpoint Hierarchy

Do NOT create:

```text id="reg190"
checkpoints/model-registry/
```

Registry operations are small and recoverable from:

```text id="reg191"
immutable decisions

mutable champion pointer
```

---

# 145. Why No Registry Checkpoint

State is already represented cleanly by:

```text id="reg192"
models/.../manifest.json

models/.../decisions/*.json

models/.../champion.json
```

Another checkpoint would duplicate truth.

---

# 146. Champion Pointer Missing

If no pointer exists:

```text id="reg193"
no current champion
```

This is valid before bootstrap.

Do not infer champion by modification time.

---

# 147. Never Infer Champion From "Newest Model"

Forbidden:

```text id="reg194"
latest registered model
=
champion
```

Champion exists only through explicit pointer.

---

# 148. Never Infer Champion From Highest Metric Automatically

Same rule.

Promotion is explicit and audited.

---

# 149. Rollback

Rollback changes:

```text id="reg195"
champion pointer
```

to a previously selected valid model/evaluation bundle.

It does NOT:

```text id="reg196"
retrain

rewrite model

restore deleted files from nowhere
```

---

# 150. Rollback Target

Recommended V1 rollback identifies:

```text id="reg197"
previous champion decision ID
```

rather than only:

```text id="reg198"
model ID
```

---

# 151. Why Rollback To Decision

A prior champion decision preserves exact:

```text id="reg199"
model

evaluation

threshold
```

selection.

Rollback should restore the full selection semantics.

---

# 152. Rollback CLI

Use:

```bash id="reg200"
python -m aurora_ml.main rollback-model \
    --task candidate \
    --to-decision-id <prior-decision-id> \
    --reason "..."
```

or:

```text id="reg201"
--task anomaly
```

---

# 153. Rollback Reason Required

Require a non-empty:

```text id="reg202"
reason
```

for audit.

Examples:

```text id="reg203"
runtime regression

unexpected Recent degradation

operator recovery after deployment incident
```

---

# 154. Rollback Target Must Be Historical Champion

V1 target decision must previously have been applied as a champion selection.

Do not call promotion of a never-selected challenger:

```text id="reg204"
rollback
```

---

# 155. Never-Promoted Model

To choose a registered model that was never a champion:

```text id="reg205"
use normal promotion policy
```

not rollback.

---

# 156. Rollback Integrity Preflight

Verify target:

```text id="reg206"
decision record valid

model package valid

model SHA valid

preprocessing SHA valid

evaluation run valid

threshold valid
```

before updating pointer.

---

# 157. Corrupt Rollback Target

If target artifacts are corrupt:

```text id="reg207"
ROLLBACK_TARGET_INTEGRITY_ERROR
```

Do not point champion to it.

---

# 158. Cross-Task Rollback

Forbidden:

```text id="reg208"
candidate champion
    ->
anomaly decision
```

---

# 159. Rollback Decision Record

Create a new immutable record:

```text id="reg209"
action=ROLLBACK

selected_model_id=<old-model>

rollback_target_decision_id=<old-selection>

expected_current_model_id=<current-model>

rollback_reason=...
```

---

# 160. Rollback Does Not Reactivate Old Decision Object

Do NOT modify the old promotion record.

A rollback is a new event in history.

---

# 161. Rollback Pointer Update

Ordering:

```text id="reg210"
verify current champion
      |
      v
verify rollback target
      |
      v
write rollback decision
      |
      v
re-read current champion
      |
      v
update pointer
      |
      v
verify
```

---

# 162. Rollback Does Not Delete Challenger

The model being rolled back from remains registered.

No history deletion.

---

# 163. Rollback Does Not Delete Evaluation

Same rule.

---

# 164. Roll Forward Later

A previously demoted model may later be reconsidered only through a new:

```text id="reg211"
promotion comparison
```

under the current applicable policy/evaluation evidence.

---

# 165. Champion History

Complete selection history can be reconstructed from:

```text id="reg212"
models/<task>/decisions/
```

and current:

```text id="reg213"
champion.json
```

---

# 166. Do Not Store Mutable History Array In Champion Pointer

Avoid:

```text id="reg214"
history: [...]
```

inside `champion.json`.

Pointer should stay compact.

History lives in immutable decision records.

---

# 167. Champion Pointer Previous Model

A compact:

```text id="reg215"
previous_model_id
```

is useful for display/debugging.

It is NOT the full history.

---

# 168. Model Listing

Optional CLI:

```bash id="reg216"
python -m aurora_ml.main model-status \
    --task candidate
```

May show:

```text id="reg217"
current champion

registered model count

recent decision records
```

---

# 169. Do Not Need Database Listing Index

At project scale:

```text id="reg218"
MinIO prefix listing
```

is sufficient.

Do not add a registry database.

---

# 170. Registered Model Is Not Automatically Runtime-Compatible

A Phase 6.5 model may still fail future:

```text id="reg219"
ONNX export

Rust inference parity
```

That does not invalidate its training/evaluation history.

---

# 171. Runtime Failure Later

If Phase 6.6 shows a champion cannot pass runtime parity:

```text id="reg220"
do not silently mutate model package
```

A later selection/rollback may choose another runtime-compatible model.

---

# 172. Phase 6.6 May Need Registry Champion

Expected future flow:

```text id="reg221"
champion.json
      |
      v
model package
      |
      v
evaluation threshold
      |
      v
ONNX runtime package
```

---

# 173. Model Registry Is Native-Model Registry

Phase 6.5 stores canonical trained model representation:

```text id="reg222"
model.pt
```

for Python training lineage.

ONNX is a derived runtime representation.

---

# 174. No ONNX File In Model Package

Mandatory in 6.5:

```text id="reg223"
models/.../<model-id>/
```

does NOT need:

```text id="reg224"
model.onnx
```

---

# 175. No `runtime_ready` Mutable Flag

Do NOT add:

```text id="reg225"
runtime_ready=false
```

to immutable model manifest and later mutate it.

Phase 6.6 uses separate runtime artifacts.

---

# 176. No Deployed Flag

Do NOT add:

```text id="reg226"
deployed=true
```

to model manifest.

Deployment state belongs elsewhere later.

---

# 177. Model Package Copy Integrity

Copied registry:

```text id="reg227"
model.pt
```

must have identical SHA256 to training-run model.

---

# 178. Preprocessing Copy Integrity

Same for:

```text id="reg228"
preprocessing.json
```

---

# 179. No Re-serialization Of Preprocessing

Prefer copying exact verified bytes.

Do not parse and rewrite JSON if doing so can change byte SHA without need.

---

# 180. Model Registration Idempotency Test

Register same training run twice.

Expected:

```text id="reg229"
same model ID

same package

no duplicate mutable state
```

---

# 181. Different Training Run Test

Different training run with different:

```text id="reg230"
model bytes
```

must produce different model ID.

---

# 182. Same Training Run, New Evaluation

Register model before/after another evaluation.

Expected:

```text id="reg231"
same model ID
```

Evaluation does not alter model identity.

---

# 183. Feature Order Change Test

Different durable model-input order:

```text id="reg232"
different model fingerprint
```

even if raw weight file somehow has same size.

---

# 184. Model Artifact Corruption Test

Corrupt training-run `model.pt`.

Registration must fail.

---

# 185. Preprocessing Corruption Test

Registration must fail.

---

# 186. Training Manifest Corruption Test

Registration must fail.

---

# 187. Partial Model Package Test

Registry model bytes exist but manifest missing.

Expected:

```text id="reg233"
not registered/committed
```

Recovery may verify/copy and commit manifest.

---

# 188. Registry Conflict Test

Deterministic model path contains incompatible object.

Expected:

```text id="reg234"
MODEL_REGISTRY_CONFLICT
```

---

# 189. Champion Resolution Test

Given valid pointer:

```text id="reg235"
resolve exact model manifest

resolve exact evaluation manifest

resolve exact threshold
```

---

# 190. Broken Champion Pointer Test

Pointer references missing model manifest.

Expected:

```text id="reg236"
CHAMPION_POINTER_INVALID
```

Do not select newest model instead.

---

# 191. Wrong Champion Model SHA Test

Expected integrity failure.

---

# 192. Wrong Champion Evaluation SHA Test

Expected integrity failure.

---

# 193. Wrong Champion Threshold SHA Test

Expected integrity failure.

---

# 194. Cross-Task Champion Pointer Test

Candidate pointer referencing anomaly model:

```text id="reg237"
reject
```

---

# 195. Bootstrap Test

No champion exists.

Valid evaluated model + explicit:

```text id="reg238"
--bootstrap
```

Expected:

```text id="reg239"
BOOTSTRAP PASS decision

champion pointer created
```

---

# 196. Bootstrap Without Evaluation

Expected failure.

---

# 197. Bootstrap With Validation Metrics Only

Expected failure.

Golden evaluation is required.

---

# 198. Bootstrap When Champion Exists

Expected:

```text id="reg240"
BOOTSTRAP_NOT_ALLOWED
```

---

# 199. Candidate Promotion Primary Pass Test

Challenger:

```text id="reg241"
higher Golden Average Precision
```

with all guardrails satisfied.

Expected:

```text id="reg242"
PASS
```

---

# 200. Candidate Equal AP Test

If challenger AP is equal within policy comparison:

```text id="reg243"
FAIL
```

V1 requires strict improvement.

---

# 201. Candidate Lower AP Test

Expected:

```text id="reg244"
FAIL
PRIMARY_METRIC_NOT_IMPROVED
```

---

# 202. Candidate Recall Regression Test

AP improves but recall drops more than:

```text id="reg245"
0.02
```

Expected:

```text id="reg246"
FAIL
```

---

# 203. Candidate Recent AP Regression Test

Comparable Recent exists and challenger regresses by more than:

```text id="reg247"
0.02
```

Expected FAIL.

---

# 204. Candidate Recent Recall Regression Test

More than:

```text id="reg248"
0.03
```

Expected FAIL.

---

# 205. Candidate Recent Not Applicable Test

Both evaluations reference same Recent cohort with insufficient class coverage.

Expected:

```text id="reg249"
recent guardrail = NOT_APPLICABLE
```

with reason recorded.

---

# 206. Candidate Different Golden Cohort Test

Expected:

```text id="reg250"
INCOMPARABLE_EVALUATIONS
```

---

# 207. Candidate Different View Test

Expected:

```text id="reg251"
INCOMPARABLE_MODEL_VIEWS
```

under V1.

---

# 208. Candidate Different Threshold Policy Test

Expected incomparability.

---

# 209. Candidate One Recent Missing Test

Expected:

```text id="reg252"
INCOMPARABLE_RECENT_EVALUATION
```

---

# 210. Candidate Both Recent Missing Test

Golden-only comparison allowed.

---

# 211. Anomaly Synthetic Improvement Test

Synthetic detection improves with alert guardrails satisfied.

Expected PASS.

---

# 212. Anomaly Alert Improvement Test

Reference alert rate decreases while synthetic detection remains within allowed
guardrail.

Expected PASS.

---

# 213. Anomaly No Improvement Test

Both metrics equal within epsilon.

Expected:

```text id="reg253"
FAIL
NO_PRIMARY_IMPROVEMENT
```

---

# 214. Anomaly Synthetic Regression Test

Regression beyond:

```text id="reg254"
0.02
```

Expected FAIL.

---

# 215. Anomaly Alert Regression Test

Increase beyond:

```text id="reg255"
0.01
```

Expected FAIL.

---

# 216. Anomaly Recent Guardrail Test

Comparable Recent metrics must satisfy V1 tolerances.

---

# 217. Anomaly Different Synthetic Policy Test

Expected:

```text id="reg256"
INCOMPARABLE_EVALUATIONS
```

---

# 218. Anomaly Different Score Definition Test

Expected incomparability.

---

# 219. Anomaly Different View Test

Expected incomparability under V1.

---

# 220. Decision Determinism Test

Same exact:

```text id="reg257"
challenger
incumbent
evaluations
policy
```

Expected same:

```text id="reg258"
decision_id
```

---

# 221. Decision Timestamp Independence

Different:

```text id="reg259"
created_at
```

does not change decision ID.

---

# 222. Decision Metric Change Test

Change one compared metric.

Expected new decision fingerprint.

---

# 223. Failed Decision Persistence Test

FAIL decision exists.

Champion pointer unchanged.

---

# 224. Compare Dry-Run Test

`compare-model`:

```text id="reg260"
does not write champion pointer
```

If implementation chooses not to persist dry-run decisions, document that.

Preferred:

```text id="reg261"
dry run computes only
```

while `promote-model` persists the authoritative decision.

---

# 225. Promotion PASS Pointer Test

After PASS:

```text id="reg262"
champion points to challenger
```

and exact challenger evaluation threshold.

---

# 226. Promotion FAIL Pointer Test

After FAIL:

```text id="reg263"
champion remains incumbent
```

---

# 227. Promotion Does Not Delete Incumbent

Old champion model package remains.

---

# 228. Promotion Does Not Delete Incumbent Evaluation

Historical evidence remains.

---

# 229. Promotion Crash After Decision

Inject crash after immutable PASS decision, before pointer update.

Restart.

Expected:

```text id="reg264"
same decision reused

pointer update completes
```

if incumbent remains unchanged.

---

# 230. Promotion Crash After Pointer PUT

Restart.

Expected:

```text id="reg265"
pointer already references intended decision

verification succeeds
```

---

# 231. Stale Promotion Test

Create PASS decision.

Change champion through another valid operation.

Attempt old pointer application.

Expected:

```text id="reg266"
CHAMPION_CHANGED
```

---

# 232. No Distributed Lock Test

Registry correctness tests should not require:

```text id="reg267"
Redis

database lock service
```

---

# 233. Rollback Previous Champion Test

History:

```text id="reg268"
A -> B
```

Rollback to A's historical selection.

Expected:

```text id="reg269"
new ROLLBACK decision

champion -> A
```

---

# 234. Rollback Does Not Delete B

B remains registered.

---

# 235. Rollback Uses Prior Threshold

Champion selection after rollback must use the exact:

```text id="reg270"
evaluation + threshold
```

from the selected historical champion decision.

---

# 236. Rollback Reason Test

Missing reason:

```text id="reg271"
reject
```

---

# 237. Rollback To Never-Champion Model Test

Expected:

```text id="reg272"
INVALID_ROLLBACK_TARGET
```

Use promotion instead.

---

# 238. Rollback Corrupt Target Test

Expected:

```text id="reg273"
ROLLBACK_TARGET_INTEGRITY_ERROR
```

---

# 239. Rollback Cross-Task Test

Expected failure.

---

# 240. Rollback Crash After Decision

Same recovery semantics as promotion.

---

# 241. Multi-Step History Test

Example:

```text id="reg274"
A bootstrap champion
    |
    v
B promoted
    |
    v
C promoted
    |
    v
rollback to B
```

Expected immutable history contains:

```text id="reg275"
BOOTSTRAP A

PROMOTE B

PROMOTE C

ROLLBACK B
```

Current pointer:

```text id="reg276"
B
```

---

# 242. No History Rewrite

Do not mark old:

```text id="reg277"
C promotion record
```

as inactive.

Current pointer defines active selection.

---

# 243. Registry Lineage

For current candidate champion answer:

```text id="reg278"
Which model is selected?
```

Then trace:

```text id="reg279"
champion.json
      |
      v
decision record
      |
      +--> model_id
      |      |
      |      v
      |   model manifest
      |      |
      |      v
      |   training run
      |      |
      |      v
      |   Gold + split
      |
      +--> evaluation run
             |
             +--> Golden cohort
             |
             +--> Recent cohort
             |
             +--> threshold
```

---

# 244. Source Provenance Continues

From training Gold the chain continues:

```text id="reg280"
Gold
  |
  v
Silver
  |
  v
Stage 4 lineage
  |
  v
source product identity
```

even when Bronze bytes have been evicted.

---

# 245. Candidate Registry Semantics

Document:

```text id="reg281"
candidate champion
=
best currently selected candidate-vetting model
under candidate-promotion-v1 evidence
```

Not:

```text id="reg282"
scientifically confirmed planet detector
```

---

# 246. Anomaly Registry Semantics

Document:

```text id="reg283"
anomaly champion
=
currently selected reconstruction model
under anomaly-promotion-v1 evidence
```

Not:

```text id="reg284"
proof of astrophysical anomaly
```

---

# 247. Registry Module Ownership

Existing:

```text id="reg285"
aurora_ml/registry.py
```

now owns:

```text id="reg286"
model registration

model manifest verification

champion resolution

evaluation compatibility checks

promotion comparison

decision materialization

champion pointer update

rollback
```

---

# 248. Do Not Create `registry/` Package Yet

Keep:

```text id="reg287"
registry.py
```

unless the real file becomes too large to maintain.

---

# 249. If Split Becomes Necessary

Only when justified, a minimal future split may be:

```text id="reg288"
registry.py
promotion.py
```

Do not pre-create it now.

---

# 250. Entrypoint Responsibility

`main.py` should only:

```text id="reg289"
parse command

resolve inputs

call registry functions

format result
```

Promotion math must not live in CLI parsing code.

---

# 251. No Generic Rules Engine

Do NOT create:

```text id="reg290"
PolicyEngine

RuleFactory

PromotionStrategyFactory
```

V1 has two explicit small policies.

---

# 252. Candidate Promotion Function

Prefer explicit function such as:

```text id="reg291"
evaluate_candidate_promotion(...)
```

---

# 253. Anomaly Promotion Function

Prefer:

```text id="reg292"
evaluate_anomaly_promotion(...)
```

---

# 254. Shared Compatibility Validation

Small shared checks are appropriate for:

```text id="reg293"
task

Golden cohort

Recent cohort

evaluation manifest integrity
```

Do not hide task-specific metrics behind excessive abstraction.

---

# 255. No Global `utils.py`

Keep registry fingerprint and selection helpers under registry ownership.

---

# 256. Model Manifest Serialization Test

Round-trip:

```text id="reg294"
model ID

fingerprint

training run refs

feature order

artifact hashes
```

---

# 257. Unknown Model Manifest Version Test

Expected clear failure.

---

# 258. Model Manifest Timestamp Test

Different registration timestamps:

```text id="reg295"
same model ID
```

---

# 259. Champion Pointer Serialization Test

Round-trip all:

```text id="reg296"
model

evaluation

threshold

decision
```

references.

---

# 260. Unknown Champion Pointer Version Test

Fail clearly.

---

# 261. Decision Serialization Test

Round-trip:

```text id="reg297"
BOOTSTRAP

PROMOTE PASS

PROMOTE FAIL

ROLLBACK
```

---

# 262. Unknown Decision Version Test

Fail clearly.

---

# 263. Candidate Metric Comparison Exactness Test

Use hard-coded metrics around each guardrail boundary.

Test:

```text id="reg298"
exact boundary passes
```

for `>=` constraints.

---

# 264. Candidate AP Strictness Test

Exact equality:

```text id="reg299"
does not count as improvement
```

---

# 265. Anomaly Guardrail Boundary Test

Exact:

```text id="reg300"
incumbent - 0.02

incumbent + 0.01
```

boundary values should follow documented `>=` / `<=`.

---

# 266. Evaluation Mismatch Test

Evaluation run references a different training run than registered model.

Expected:

```text id="reg301"
MODEL_EVALUATION_MISMATCH
```

---

# 267. Threshold Mismatch Test

Evaluation threshold artifact checksum differs.

Expected failure.

---

# 268. Golden Cohort Mismatch Test

Expected incomparability before metric comparison.

---

# 269. Recent Cohort Mismatch Test

Expected incomparability.

---

# 270. Dataset View Mismatch Test

Expected V1 incomparability.

---

# 271. Policy Version Mismatch Test

Expected V1 incomparability.

---

# 272. Candidate Bootstrap Integration

Flow:

```text id="reg302"
candidate training run
      |
      v
register model
      |
      v
candidate evaluation
      |
      v
bootstrap
      |
      v
candidate champion
```

---

# 273. Candidate Challenger Integration

Flow:

```text id="reg303"
candidate challenger training run
      |
      v
register model
      |
      v
evaluate on same Golden
      |
      v
compare
      |
      v
PROMOTE PASS / FAIL
```

---

# 274. Anomaly Bootstrap Integration

Same workflow for anomaly task.

---

# 275. Anomaly Challenger Integration

Verify task-specific policy.

---

# 276. Candidate Promotion Integration PASS

Use deterministic fixture metrics where challenger passes.

Expected champion changes.

---

# 277. Candidate Promotion Integration FAIL

Use deterministic regression fixture.

Expected champion unchanged.

---

# 278. Anomaly Promotion Integration PASS

Expected champion changes.

---

# 279. Anomaly Promotion Integration FAIL

Expected champion unchanged.

---

# 280. Rollback Integration

Promote two models then rollback.

Verify exact previous:

```text id="reg304"
model

evaluation

threshold
```

bundle restored.

---

# 281. Registry Offline Integration

Disable external network.

Registration/promotion/rollback all work.

---

# 282. ClickHouse Offline Integration

Stop ClickHouse.

Registry works.

---

# 283. NATS Offline Integration

Stop NATS.

Registry works.

---

# 284. Go API Offline Integration

No effect.

---

# 285. Dashboard Offline Integration

No effect.

---

# 286. GPU Unavailable Integration

Registry operations do not require GPU.

---

# 287. RAW_DELETED Provenance Integration

Champion may trace to Gold produced after safe Bronze eviction.

Registry must not care whether Bronze bytes still exist.

---

# 288. Zero Bronze Reads Integration

Instrument storage across:

```text id="reg305"
register

compare

promote

rollback
```

Expected:

```text id="reg306"
Bronze reads = 0
```

---

# 289. Zero Silver Reads Integration

Expected:

```text id="reg307"
Silver reads = 0
```

---

# 290. No Gold Full-Table Read Integration

Registry should not scan all Gold rows.

It operates from durable training/evaluation provenance.

---

# 291. No Training Mutation Integration

Record training-run hashes before registry operations.

After:

```text id="reg308"
unchanged
```

---

# 292. No Evaluation Mutation Integration

Same.

---

# 293. No Gold Mutation Integration

Same.

---

# 294. No Split Mutation Integration

Same.

---

# 295. No Cohort Mutation Integration

Same.

---

# 296. Registry Output Scope

Phase 6.5 may write only:

```text id="reg309"
models/candidate/

models/anomaly/
```

including:

```text id="reg310"
immutable model packages

immutable decision records

mutable champion pointer
```

---

# 297. No Runtime Package Yet

Do NOT create:

```text id="reg311"
runtime-models/

runtime-packages/
```

until Phase 6.6.

---

# 298. No `model.onnx`

Mandatory.

---

# 299. No Prediction Output

Do NOT write:

```text id="reg312"
predictions/
```

---

# 300. No Inference Checkpoint

Do NOT create:

```text id="reg313"
checkpoints/inference/
```

yet.

---

# 301. No Rust Changes

Do not modify:

```text id="reg314"
apps/rust-inference/
```

in Phase 6.5.

---

# 302. No Prediction Event

No:

```text id="reg315"
aurora.v1.prediction.*
```

yet.

---

# 303. No API Model Switching

Go API does not resolve champion yet.

---

# 304. No Dashboard Model Controls

React does not get:

```text id="reg316"
promote

rollback
```

buttons.

Registry mutations remain explicit operator CLI actions.

---

# 305. No Automated Promotion Daemon

Do not automatically watch new evaluation runs and promote models.

Promotion requires explicit command.

---

# 306. No Scheduled Retraining

Out of scope.

---

# 307. Model Registry Documentation

Create:

```text id="reg317"
docs/MODEL_REGISTRY.md
```

---

# 308. Registry Documentation Contents

Document:

```text id="reg318"
training run vs registered model

model ID identity

immutable model package

challenger semantics

registry champion semantics

candidate promotion policy

anomaly promotion policy

bootstrap

decision records

rollback

champion pointer

registry champion != deployed runtime
```

---

# 309. Candidate Policy Documentation

Include exact:

```text id="reg319"
Golden AP strict improvement

Golden recall tolerance = 0.02

Recent AP tolerance = 0.02

Recent recall tolerance = 0.03
```

---

# 310. Anomaly Policy Documentation

Include exact:

```text id="reg320"
Golden synthetic tolerance = 0.02

Golden reference alert tolerance = 0.01

at least one Golden metric strictly improves

Recent synthetic tolerance = 0.02

Recent reference alert tolerance = 0.01
```

---

# 311. Policy Limitation Documentation

State clearly:

```text id="reg321"
promotion-v1 requires compatible dataset views
```

Cross-view model comparison needs an explicitly versioned future policy.

---

# 312. Bootstrap Documentation

State:

```text id="reg322"
bootstrap does not imply scientific quality threshold
```

It means:

```text id="reg323"
first explicitly selected model with valid final evaluation
```

---

# 313. Rollback Documentation

State:

```text id="reg324"
rollback restores a previously selected model/evaluation/threshold bundle
```

not merely model bytes.

---

# 314. Update ML_EVALUATION.md

Add:

```text id="reg325"
Phase 6.4 evaluation artifacts are immutable promotion evidence.
```

Do not duplicate registry implementation details.

---

# 315. Update ML_TRAINING.md

Add concise flow:

```text id="reg326"
training run
    ->
registry model
```

after evaluation.

---

# 316. Update CHECKPOINTS.md

Important:

```text id="reg327"
no model-registry checkpoint
```

Final implemented hierarchy remains:

```text id="reg328"
checkpoints/
├── ingestion/
├── preprocessing/
├── feature-engineering/
├── ml-training/
└── lifecycle/
```

---

# 317. Do Not Add Inference Checkpoint Yet

That remains Phase 6.6/Stage 7 ownership if needed.

---

# 318. Update CONFIGURATION.md

Promotion policy constants should be versioned code/contract semantics.

Do NOT expose them casually as:

```text id="reg329"
environment variables
```

that change policy without version change.

---

# 319. CLI Configuration

Explicit:

```text id="reg330"
model ID

evaluation run ID

rollback target
```

belong as command arguments.

---

# 320. Python README

Add:

```text id="reg331"
completed training
      |
      v
final evaluation
      |
      v
register immutable model
      |
      v
challenger comparison
      |
      v
registry champion
```

---

# 321. Contracts README

Add:

```text id="reg332"
model-manifest-v1

model-promotion-v1
```

---

# 322. STRUCTURE.md

Reflect actual registry artifacts/contracts.

No future runtime package structure yet.

---

# 323. Expected Python Tree

Likely no new Python module:

```text id="reg333"
aurora_ml/
├── evaluate.py
├── registry.py
├── transit/
│   ├── model.py
│   └── train.py
└── anomaly/
    ├── model.py
    └── train.py
```

Use existing:

```text id="reg334"
registry.py
```

---

# 324. Suggested Test File

Add:

```text id="reg335"
tests/test_registry.py
```

Avoid several tiny files until justified.

---

# 325. Test Fixture Strategy

Use tiny immutable:

```text id="reg336"
training-run manifests

evaluation-run manifests

model/preprocessing files

threshold files
```

No real long training required for most registry tests.

---

# 326. Real Training Integration

Include at least one integration using actual tiny:

```text id="reg337"
Phase 6.2 candidate training run

Phase 6.3 anomaly training run
```

to catch artifact-contract drift.

---

# 327. No NASA Network

Normal registry tests are completely offline.

---

# 328. No GPU CI Requirement

None.

---

# 329. No New E2E Script Yet

Full:

```text id="reg338"
Gold -> training -> evaluation -> registry -> ONNX -> Rust
```

belongs to Phase 6.7.

Phase 6.5 uses integration tests.

---

# 330. Phase 6.6 Handoff

After Phase 6.5, Phase 6.6 can resolve:

```text id="reg339"
candidate champion
```

and:

```text id="reg340"
anomaly champion
```

into exact:

```text id="reg341"
model ID

model.pt

preprocessing.json

evaluation threshold

feature order

model semantics
```

---

# 331. Candidate Runtime Handoff

Concept:

```text id="reg342"
candidate champion pointer
       |
       +--> model-v1
       |       |
       |       +--> model.pt
       |       +--> preprocessing.json
       |
       +--> evaluation run
               |
               +--> threshold.json
```

---

# 332. Anomaly Runtime Handoff

Same:

```text id="reg343"
anomaly champion
       |
       +--> autoencoder
       +--> preprocessing
       +--> p99 threshold
       +--> reconstruction-mse-v1
```

---

# 333. No Runtime Mutation Of Champion Model

Phase 6.6 must create derived runtime artifacts.

It must not add files into the immutable Phase 6.5 model package.

---

# 334. Core Invariants

Invariant 1:

```text id="reg345"
Only completed verified training runs may be registered.
```

Invariant 2:

```text id="reg346"
Registration never retrains a model.
```

Invariant 3:

```text id="reg347"
Registry model packages are immutable.
```

Invariant 4:

```text id="reg348"
Model identity is deterministic from trained model/preprocessing provenance.
```

Invariant 5:

```text id="reg349"
Evaluation runs do not change model ID.
```

Invariant 6:

```text id="reg350"
Model manifests never contain mutable champion/challenger status.
```

Invariant 7:

```text id="reg351"
A challenger is any eligible registered non-champion model.
```

Invariant 8:

```text id="reg352"
Only champion.json represents current registry selection.
```

Invariant 9:

```text id="reg353"
Registry champion does not imply runtime deployment.
```

Invariant 10:

```text id="reg354"
Promotion requires a completed Phase 6.4 evaluation.
```

Invariant 11:

```text id="reg355"
Promotion never reruns Golden Test.
```

Invariant 12:

```text id="reg356"
Promotion compares the same Golden cohort.
```

Invariant 13:

```text id="reg357"
Promotion-v1 compares compatible dataset views/policies only.
```

Invariant 14:

```text id="reg358"
Candidate promotion uses Golden Average Precision as primary metric.
```

Invariant 15:

```text id="reg359"
Candidate promotion enforces Golden/Recent guardrails.
```

Invariant 16:

```text id="reg360"
Anomaly promotion uses reference-alert and synthetic-detection evidence.
```

Invariant 17:

```text id="reg361"
Anomaly promotion never claims supervised anomaly accuracy.
```

Invariant 18:

```text id="reg362"
Promotion decisions are immutable.
```

Invariant 19:

```text id="reg363"
A PASS decision is written before champion pointer mutation.
```

Invariant 20:

```text id="reg364"
A FAIL decision never changes champion state.
```

Invariant 21:

```text id="reg365"
Bootstrap is explicit and allowed only when no champion exists.
```

Invariant 22:

```text id="reg366"
Rollback restores a prior selected model/evaluation/threshold bundle.
```

Invariant 23:

```text id="reg367"
Rollback never overwrites or deletes model history.
```

Invariant 24:

```text id="reg368"
No force option bypasses promotion policy.
```

Invariant 25:

```text id="reg369"
Registry mutations do not require a distributed lock service.
```

Invariant 26:

```text id="reg370"
Registry performs zero Bronze reads.
```

Invariant 27:

```text id="reg371"
Registry performs zero Silver reads.
```

Invariant 28:

```text id="reg372"
ClickHouse is not required.
```

Invariant 29:

```text id="reg373"
No ONNX artifact is created in Phase 6.5.
```

Invariant 30:

```text id="reg374"
No prediction artifact/event is created in Phase 6.5.
```

---

# Definition of Done

Phase 6.5 is COMPLETE when:

* [ ] Existing `aurora_ml/registry.py` owns registry behavior.
* [ ] No unnecessary registry framework/package hierarchy is introduced.
* [ ] `contracts/data/model-manifest-v1.md` exists.
* [ ] `contracts/data/model-promotion-v1.md` exists.
* [ ] Candidate registry prefix exists when first candidate model is registered.
* [ ] Anomaly registry prefix exists when first anomaly model is registered.
* [ ] Registry model packages contain immutable `model.pt`.
* [ ] Registry model packages contain immutable `preprocessing.json`.
* [ ] Registry model package manifest is written last.
* [ ] Model manifest acts as package commit marker.
* [ ] Partial package without manifest is not considered registered.
* [ ] Training-run manifest integrity is verified before registration.
* [ ] Training model SHA is verified before registration.
* [ ] Training preprocessing SHA is verified before registration.
* [ ] Gold/split/view provenance is preserved in model manifest.
* [ ] Feature order is preserved in model manifest.
* [ ] Candidate task/model-version compatibility is validated.
* [ ] Anomaly task/model-version compatibility is validated.
* [ ] Unsupported model version is rejected.
* [ ] Model fingerprint uses canonical serialization.
* [ ] Model fingerprint includes task.
* [ ] Model fingerprint includes training-run identity/provenance.
* [ ] Model fingerprint includes model version/SHA.
* [ ] Model fingerprint includes preprocessing version/SHA.
* [ ] Model fingerprint includes dataset-view identity.
* [ ] Model fingerprint includes exact feature order.
* [ ] Evaluation-run ID does not affect model ID.
* [ ] Registration timestamp does not affect model ID.
* [ ] Operational storage/log settings do not affect model ID.
* [ ] Model ID is deterministic.
* [ ] Same training model registered twice produces same model ID.
* [ ] New evaluation of same model does not create a new model ID.
* [ ] Different model bytes produce different model identity.
* [ ] Different preprocessing artifact produces different model identity.
* [ ] Different feature-order contract changes model identity.
* [ ] Registered model copy has same SHA as training artifact.
* [ ] Registered preprocessing copy has same SHA as training artifact.
* [ ] Existing identical package is reused idempotently.
* [ ] Existing conflicting package is rejected.
* [ ] Registered package is immutable after manifest commit.
* [ ] Registration never mutates training run.
* [ ] Registration never mutates evaluation run.
* [ ] Registration never mutates Gold.
* [ ] Registration never mutates split.
* [ ] Registration never mutates evaluation cohort.
* [ ] Registered model manifest contains no mutable `champion` status.
* [ ] Registered model manifest contains no mutable `challenger` status.
* [ ] Challenger semantics are relational rather than a mutable flag.
* [ ] Multiple challengers may coexist.
* [ ] `models/candidate/champion.json` is the candidate current-selection pointer.
* [ ] `models/anomaly/champion.json` is the anomaly current-selection pointer.
* [ ] Champion pointer is small mutable state.
* [ ] Champion pointer references exact model ID.
* [ ] Champion pointer references model-manifest SHA.
* [ ] Champion pointer references exact evaluation-run ID.
* [ ] Champion pointer references evaluation-manifest SHA.
* [ ] Champion pointer references exact threshold artifact.
* [ ] Champion pointer references threshold SHA.
* [ ] Champion pointer references exact selection decision.
* [ ] Champion pointer records previous model ID for diagnostics.
* [ ] Candidate pointer cannot reference anomaly model.
* [ ] Anomaly pointer cannot reference candidate model.
* [ ] Broken champion pointer is rejected.
* [ ] Champion model integrity is verified.
* [ ] Champion preprocessing integrity is verified.
* [ ] Champion evaluation integrity is verified.
* [ ] Champion threshold integrity is verified.
* [ ] Champion is documented as registry champion, not deployed runtime.
* [ ] No `runtime_ready` mutable field exists in model manifest.
* [ ] No `deployed` mutable field exists in model manifest.
* [ ] `models/<task>/decisions/` contains immutable decision records.
* [ ] BOOTSTRAP decision action exists.
* [ ] PROMOTE decision action exists.
* [ ] ROLLBACK decision action exists.
* [ ] Promotion outcomes use PASS/FAIL.
* [ ] Failed promotion can be persisted for audit.
* [ ] Failed promotion does not change champion pointer.
* [ ] Decision fingerprint is deterministic.
* [ ] Decision ID is deterministic.
* [ ] Decision ID ignores `created_at`.
* [ ] Exact repeated promotion decision is idempotent.
* [ ] Conflicting deterministic decision is rejected.
* [ ] Decision record preserves expected current champion.
* [ ] Decision record preserves challenger model/evaluation.
* [ ] Decision record preserves incumbent model/evaluation.
* [ ] Decision record preserves policy version.
* [ ] Decision record preserves compared metric values.
* [ ] Decision record preserves guardrail outcomes.
* [ ] Decision record preserves reason codes.
* [ ] Decision record itself does not falsely claim pointer application.
* [ ] Current champion state is determined by `champion.json`.
* [ ] `register-model` command exists or equivalent.
* [ ] Registration command does not promote.
* [ ] `compare-model` command exists or equivalent dry comparison.
* [ ] Dry comparison never mutates champion pointer.
* [ ] `promote-model` command exists or equivalent.
* [ ] `rollback-model` command exists or equivalent.
* [ ] `model-status` exists if useful, without introducing a database.
* [ ] Promotion requires registered challenger model.
* [ ] Promotion requires valid completed evaluation run.
* [ ] Challenger evaluation must reference the challenger training artifacts.
* [ ] Incumbent evaluation must reference current champion training artifacts.
* [ ] Candidate/anomaly tasks cannot be cross-compared.
* [ ] Golden cohort IDs must match for head-to-head comparison.
* [ ] Different Golden cohorts are rejected as incomparable.
* [ ] Evaluation-policy versions must be compatible.
* [ ] Threshold-policy versions must be compatible.
* [ ] Candidate promotion V1 requires matching dataset-view version/fingerprint.
* [ ] Anomaly promotion V1 requires matching dataset-view version/fingerprint.
* [ ] Anomaly score-definition version must match.
* [ ] Anomaly synthetic-policy version must match.
* [ ] If both evaluations use Recent Holdout, Recent cohort IDs must match.
* [ ] If one evaluation has Recent and one does not, V1 comparison rejects them as incomparable.
* [ ] Both evaluations may omit Recent and compare on Golden only.
* [ ] Candidate `candidate-promotion-v1` exists.
* [ ] Candidate primary metric is Golden Average Precision.
* [ ] Candidate Golden Average Precision must strictly improve.
* [ ] Candidate AP equality does not count as improvement.
* [ ] Candidate Golden recall may not regress by more than `0.02`.
* [ ] Candidate Recent Average Precision may not regress by more than `0.02` when applicable.
* [ ] Candidate Recent recall may not regress by more than `0.03` when applicable.
* [ ] Candidate Recent insufficient-class-coverage handling is explicit.
* [ ] Candidate promotion policy constants are versioned semantics.
* [ ] Candidate promotion is not based on training loss.
* [ ] Candidate promotion is not based solely on validation metrics.
* [ ] Candidate promotion is not based primarily on accuracy.
* [ ] Anomaly `anomaly-promotion-v1` exists.
* [ ] Anomaly Golden synthetic detection may not regress by more than `0.02`.
* [ ] Anomaly Golden reference alert rate may not increase by more than `0.01`.
* [ ] Anomaly promotion requires at least one strict Golden improvement.
* [ ] Anomaly Recent synthetic detection may not regress by more than `0.02` when applicable.
* [ ] Anomaly Recent reference alert rate may not increase by more than `0.01` when applicable.
* [ ] Anomaly promotion does not use supervised accuracy.
* [ ] Anomaly promotion does not use raw reconstruction loss as the primary cross-model criterion.
* [ ] Candidate guardrail boundary tests pass.
* [ ] Anomaly guardrail boundary tests pass.
* [ ] Incompatible evaluation tests pass.
* [ ] Candidate promotion PASS test passes.
* [ ] Candidate promotion FAIL-primary test passes.
* [ ] Candidate promotion FAIL-recall test passes.
* [ ] Candidate promotion FAIL-Recent-AP test passes.
* [ ] Candidate promotion FAIL-Recent-recall test passes.
* [ ] Anomaly promotion PASS-synthetic-improvement test passes.
* [ ] Anomaly promotion PASS-alert-improvement test passes.
* [ ] Anomaly promotion FAIL-no-improvement test passes.
* [ ] Anomaly synthetic-regression guardrail test passes.
* [ ] Anomaly alert-regression guardrail test passes.
* [ ] First champion bootstrap requires explicit `--bootstrap`.
* [ ] Bootstrap requires no existing champion.
* [ ] Bootstrap requires completed final evaluation.
* [ ] Bootstrap cannot use only Phase 6.2/6.3 validation metrics.
* [ ] Bootstrap creates immutable BOOTSTRAP decision.
* [ ] Bootstrap creates champion pointer only after decision commit.
* [ ] Bootstrap does not require an arbitrary universal accuracy floor.
* [ ] Bootstrap fails if champion already exists.
* [ ] No `--force` option bypasses promotion policy.
* [ ] PASS decision is written before champion pointer mutation.
* [ ] FAIL decision leaves pointer unchanged.
* [ ] Current champion is re-read before pointer mutation.
* [ ] Stale promotion detects changed champion.
* [ ] Registry V1 documents one intentional mutation operation per task at a time.
* [ ] No Redis lock exists.
* [ ] No database lock exists.
* [ ] Champion pointer PUT is verified after write.
* [ ] Crash after PASS decision before pointer is recoverable.
* [ ] Crash after pointer write before verification is recoverable.
* [ ] Pointer-write failure does not corrupt immutable decision/model history.
* [ ] No model-registry checkpoint hierarchy exists.
* [ ] Champion is never inferred from newest model.
* [ ] Champion is never inferred automatically from highest metric.
* [ ] Rollback targets a prior champion decision.
* [ ] Rollback requires explicit reason.
* [ ] Rollback target task must match.
* [ ] Rollback target model must verify.
* [ ] Rollback target preprocessing must verify.
* [ ] Rollback target evaluation must verify.
* [ ] Rollback target threshold must verify.
* [ ] Never-promoted model cannot be selected through rollback.
* [ ] Choosing a never-promoted challenger requires normal promotion.
* [ ] Rollback creates a new immutable ROLLBACK decision.
* [ ] Rollback never mutates old promotion decision.
* [ ] Rollback restores exact prior model/evaluation/threshold selection.
* [ ] Rollback never deletes current/old model packages.
* [ ] Rollback never deletes training runs.
* [ ] Rollback never deletes evaluation runs.
* [ ] Rollback history is reconstructable.
* [ ] Multi-step promotion/rollback history test passes.
* [ ] Model registration integration using real tiny candidate training run passes.
* [ ] Model registration integration using real tiny anomaly training run passes.
* [ ] Candidate bootstrap integration passes.
* [ ] Anomaly bootstrap integration passes.
* [ ] Candidate challenger promotion integration passes.
* [ ] Anomaly challenger promotion integration passes.
* [ ] Candidate promotion failure leaves champion unchanged.
* [ ] Anomaly promotion failure leaves champion unchanged.
* [ ] Rollback integration restores exact prior selection.
* [ ] Registry works with external network disabled.
* [ ] Registry works with ClickHouse offline.
* [ ] Registry works with NATS offline.
* [ ] Registry works with Go API offline.
* [ ] Registry works without dashboard.
* [ ] Registry works without GPU.
* [ ] Registry works for models whose Gold lineage originates from RAW_DELETED Bronze.
* [ ] Registry performs zero Bronze reads.
* [ ] Registry performs zero Silver reads.
* [ ] Registry does not scan full Gold data.
* [ ] Registry does not mutate training artifacts.
* [ ] Registry does not mutate evaluation artifacts.
* [ ] Registry does not mutate split/cohort artifacts.
* [ ] Registry does not mutate Gold.
* [ ] No ONNX file is created.
* [ ] No runtime package is created.
* [ ] No runtime-ready/deployed state is added to immutable model manifest.
* [ ] No Rust inference code is changed.
* [ ] No inference checkpoint is created.
* [ ] No prediction objects are created.
* [ ] No prediction NATS event is created.
* [ ] No Go API model-switching endpoint is created.
* [ ] No React promotion/rollback control is created.
* [ ] No automated promotion daemon exists.
* [ ] No automated retraining is triggered by promotion.
* [ ] `docs/MODEL_REGISTRY.md` exists.
* [ ] `docs/MODEL_REGISTRY.md` documents model identity.
* [ ] `docs/MODEL_REGISTRY.md` documents immutable package semantics.
* [ ] `docs/MODEL_REGISTRY.md` documents challenger semantics.
* [ ] `docs/MODEL_REGISTRY.md` documents registry champion vs deployment.
* [ ] `docs/MODEL_REGISTRY.md` documents candidate promotion policy.
* [ ] `docs/MODEL_REGISTRY.md` documents anomaly promotion policy.
* [ ] `docs/MODEL_REGISTRY.md` documents bootstrap.
* [ ] `docs/MODEL_REGISTRY.md` documents decision records.
* [ ] `docs/MODEL_REGISTRY.md` documents rollback.
* [ ] `docs/ML_EVALUATION.md` links evaluation artifacts to registry promotion.
* [ ] `docs/ML_TRAINING.md` documents training-run -> registry-model boundary.
* [ ] `docs/CHECKPOINTS.md` confirms there is no model-registry checkpoint.
* [ ] `docs/CONFIGURATION.md` does not expose promotion-policy semantics as mutable environment knobs.
* [ ] Python README documents training -> evaluation -> registry champion flow.
* [ ] Contracts README includes `model-manifest-v1`.
* [ ] Contracts README includes `model-promotion-v1`.
* [ ] STRUCTURE.md matches actual changes.
* [ ] `tests/test_registry.py` exists or equivalent focused tests exist.
* [ ] Existing Stage 5 and Phase 6.1–6.4 tests remain green.
* [ ] Repository is ready for Phase 6.6.

---

# Out of Scope

Do NOT implement in Phase 6.5:

* ONNX export
* ONNX model package
* runtime-model package
* model-runtime-v1
* Python/ONNX numerical parity
* Python/Rust numerical parity
* ONNX Runtime CUDA provider
* Rust model hot reload
* Rust champion resolution
* inference checkpoint
* prediction schema
* prediction storage
* prediction NATS subjects
* Go API inference endpoints
* dashboard model switching
* automated deployment
* automated champion promotion
* automated retraining
* cross-view promotion under V1
* model deletion
* training-run deletion
* evaluation-run deletion
* Golden benchmark deletion
* scientific planet confirmation
* scientific anomaly confirmation

---

# Next

```text id="reg344"
Stage 6 — Machine Learning Training, Evaluation & Model Registry

Phase 6.1  ML Dataset View & Deterministic Group Split        [DONE]

Phase 6.2  Candidate Vetting Model Training                   [DONE]

Phase 6.3  Astronomical Anomaly Detection Training            [DONE]

Phase 6.4  Evaluation — Golden Test & Recent Holdout          [DONE]

Phase 6.5  Model Registry — Champion / Challenger,
           Promotion & Rollback                               [DONE]

Phase 6.6  ONNX Export & Rust Inference Parity
```

```
```
