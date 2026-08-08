````md
# CHECKLIST_PHASE_6_3.md

# Stage 6 — Machine Learning Training, Evaluation & Model Registry
## Phase 6.3 — Astronomical Anomaly Detection Training

Status: TODO

Goal:

> Train the first reproducible AURORA astronomical anomaly-detection model
> from one explicit immutable Gold anomaly snapshot.
>
> V1 deliberately uses:
>
>     Gold light-curve anomaly scalar features
>             ->
>     compact tabular autoencoder
>
> rather than:
>
>     raw FITS
>     full Silver time-series tensors
>     giant FFI tensors
>
> The model learns the structure of the observed feature distribution and
> produces reconstruction-error evidence that can later be used to rank
> unusual astronomical observations.
>
> Phase 6.3 introduces:
>
> - anomaly-specific ML dataset view,
> - deterministic target-group TRAIN / VALIDATION split,
> - train-only anomaly preprocessing,
> - small tabular autoencoder,
> - deterministic anomaly-score definition,
> - immutable anomaly training runs,
> - ML-training checkpoint recovery,
> - development reconstruction metrics.
>
> It does NOT:
>
> - claim astrophysical ground truth,
> - use TOI/TCE labels as anomaly supervision,
> - define the final anomaly threshold,
> - evaluate the frozen golden test,
> - create a champion model,
> - export ONNX,
> - persist anomaly predictions,
> - train directly from Bronze/Silver.

---

# 1. V1 Scope Decision

Freeze the mandatory V1 learned anomaly model as:

```text
anomaly-lightcurve-autoencoder-v1
````

Input source:

```text
Gold anomaly snapshot
    |
    v
anomaly/lightcurve component
```

TPF/FFI remain:

```text
deterministic anomaly/vetting evidence
```

but do NOT require separate learned TPF/FFI models in V1.

---

# 2. Why Light-Curve Autoencoder First

Current Stage 5 Gold already contains compact LC evidence such as:

```text
time coverage

cadence statistics

flux variability

robust scatter

amplitude

skewness

kurtosis
```

This is sufficient to validate the entire:

```text
Gold
 ->
training
 ->
evaluation
 ->
registry
 ->
ONNX
 ->
Rust
```

lifecycle without reopening the raw-array boundary.

---

# 3. Do Not Force TPF/FFI Models Yet

Do NOT create mandatory:

```text
anomaly-tpf-autoencoder-v1

anomaly-ffi-autoencoder-v1
```

only to increase model count.

A future model may use those evidence families after:

```text
dataset size
scientific value
runtime need
```

justify them.

---

# 4. Canonical Input

Required:

```text
explicit COMMITTED anomaly Gold snapshot
+
explicit anomaly split ID
+
anomaly-lightcurve-ml-view-v1
+
explicit training configuration
+
explicit training seed
```

---

# 5. Canonical Flow

```text
Committed Gold anomaly snapshot
             |
             v
 anomaly/lightcurve Gold table
             |
             v
 anomaly-lightcurve-ml-view-v1
             |
             v
 deterministic group split
        +----------+
        |          |
        v          v
      TRAIN    VALIDATION
        |          |
        v          |
 fit preprocessing |
        |          |
        v          |
   autoencoder     |
        |          |
        +-----+----+
              |
              v
 development reconstruction
       error distribution
              |
              v
 immutable training run
```

---

# 6. Gold-Only Requirement

Normal Phase 6.3 reads:

```text
gold/
manifests/ml-splits/
```

Expected:

```text
Bronze reads = 0

Silver reads = 0
```

---

# 7. RAW_DELETED Compatibility

This remains valid:

```text
Bronze = RAW_DELETED

Silver = durable

Gold = committed
```

Then:

```text
anomaly training succeeds
```

No source-product restoration.

---

# 8. ClickHouse Independence

Do NOT train canonical anomaly model from:

```sql
SELECT *
FROM anomaly_lightcurve_v1
```

ClickHouse may be used for exploration only.

Canonical training source remains:

```text
Gold Parquet
```

---

# 9. ClickHouse Loss Test

Mandatory:

```text
ClickHouse unavailable
         |
         X
         |
Gold + anomaly split
         |
         v
anomaly training succeeds
```

---

# 10. No Live Catalog Calls

Do not query:

```text
TIC

TOI

TCE
```

during anomaly model training.

---

# 11. No Label Supervision

The V1 anomaly autoencoder is unsupervised.

Do NOT use:

```text
POSITIVE

NEGATIVE

UNRESOLVED

EXCLUDED

TOI disposition

TCE disposition
```

to define the training loss.

---

# 12. Important Separation

Freeze:

```text
candidate model
    =
catalog-supervised classifier
```

```text
anomaly model
    =
unsupervised reconstruction model
```

Do not make anomaly training secretly another planet classifier.

---

# 13. Python Ownership

Use existing:

```text
aurora_ml/anomaly/
├── model.py
└── train.py
```

Responsibilities:

```text
anomaly/model.py
    autoencoder architecture

anomaly/train.py
    anomaly preprocessing
    training
    reconstruction scoring
    validation
    run orchestration
```

---

# 14. Reuse Existing Split Infrastructure

Reuse:

```text
aurora_ml/splits.py
```

for:

```text
canonical group keys

SHA256 group assignment

split manifest persistence

split validation
```

Do not create a second independent splitter.

---

# 15. Anomaly Dataset View

Introduce:

```text
anomaly-lightcurve-ml-view-v1
```

---

# 16. Dataset View Contract

Add:

```text
contracts/data/ml-anomaly-view-v1.md
```

Document:

```text
source Gold component

row identity

feature list

feature order

group identity

nullable semantics

eligibility policy
```

---

# 17. Reuse `ml-split-v1`

Use the existing durable:

```text
contracts/data/ml-split-v1.md
```

for anomaly split manifests if its schema is already generic as intended.

Do NOT create another split schema merely because the task differs.

The anomaly split is distinguished by:

```text
dataset_view_version
split_policy_version
gold_snapshot_id
```

---

# 18. Anomaly Split Policy

Introduce:

```text
anomaly-group-split-v1
```

---

# 19. Group Leakage Rule

Same target-level invariant applies:

```text
same TIC
    ->
same split
```

even though training is unsupervised.

This prevents the model from seeing one observation of a target during
training and an almost-identical observation of that target during validation.

---

# 20. Group Key

Use the existing V1 grouping semantics:

```text
tic:<tic-id>
```

when TIC exists.

Fallback:

```text
source:<source-product-id>
```

when TIC is unavailable.

---

# 21. Do Not Group By Sector Alone

Wrong:

```text
group_key = sector
```

Sector is observational context, not target identity.

---

# 22. Do Not Group By `sample_id` Alone

One TIC may have multiple samples/sectors.

Use target identity first.

---

# 23. TRAIN / VALIDATION Only

Phase 6.3 development split uses:

```text
TRAIN

VALIDATION
```

Do NOT define:

```text
GOLDEN_TEST

RECENT_HOLDOUT
```

here.

Phase 6.4 owns final evaluation sets.

---

# 24. Default Split Ratio

Reuse Phase 6.1 V1 group policy where practical:

```text
TRAIN      80%

VALIDATION 20%
```

at group level.

---

# 25. Stable Cumulative Membership

For same:

```text
group key
split seed
split policy
```

membership remains stable across cumulative Gold snapshots.

---

# 26. Anomaly Split CLI

Extend existing split command cleanly:

```bash
python -m aurora_ml.main ml-split \
    --task anomaly-lightcurve \
    --snapshot-id <gold-anomaly-snapshot-id> \
    --seed 42
```

or an equivalent existing CLI shape.

Do NOT create an unrelated second splitting program.

---

# 27. Split Manifest Storage

Reuse:

```text
manifests/ml-splits/<split-id>.json
```

---

# 28. Anomaly Split Identity

Must depend on:

```text
Gold snapshot ID

anomaly-lightcurve-ml-view-v1

anomaly-group-split-v1

split seed

canonical group assignments
```

---

# 29. Split Assignment Must Not Depend on Model Score

Do NOT use:

```text
reconstruction error

feature extremeness

known anomaly status
```

when assigning TRAIN/VALIDATION groups.

---

# 30. No "Clean" Cohort Filtering From Labels

Do NOT define TRAIN as:

```text
all rows not marked planet

all rows without TOI

all rows labelled negative
```

That would make external catalog state influence the supposedly unsupervised
anomaly model.

---

# 31. V1 Eligibility

A Gold LC anomaly row is eligible when:

```text
row identity valid

Gold contract valid

all required anomaly-view inputs structurally valid
```

Optional nullable inputs do not automatically remove the row.

---

# 32. No Candidate Label Filtering

Rows remain eligible regardless of:

```text
TOI state

candidate training label
```

if such information is available elsewhere.

Anomaly learning must remain label-independent.

---

# 33. Gold Component

Use:

```text
gold-anomaly-v1
    ->
lightcurve component
```

Do not train anomaly V1 from:

```text
gold-candidate-v1
```

just because its rows also contain LC features.

---

# 34. Why Separate Gold Component

The anomaly dataset should represent the broader LC population.

Candidate Gold may already have candidate-oriented joins/selection semantics.

Keep anomaly training attached to:

```text
Gold anomaly lightcurve table
```

---

# 35. Anomaly V1 Feature Philosophy

Prefer generic observation/variability statistics.

Recommended categories:

```text
TIME COVERAGE

CADENCE / GAP STRUCTURE

ROBUST FLUX VARIABILITY

DISTRIBUTION SHAPE
```

---

# 36. Recommended Model Inputs

Use actual existing contract names corresponding to:

```text
n_points

time_span

median_cadence

max_gap

flux_mean

flux_median

flux_std

flux_mad

flux_amplitude

flux_rms

flux_skewness

flux_kurtosis
```

Only include fields that exist in the frozen Gold V1 contract.

---

# 37. BLS Features in Anomaly V1

Recommended:

```text
exclude BLS-specific candidate features
```

from mandatory `anomaly-lightcurve-ml-view-v1`.

Reason:

```text
anomaly model should first learn generic LC statistical structure
```

rather than primarily learning:

```text
transit-search strength
```

---

# 38. If BLS Is Included

Only include BLS fields if the actual implementation deliberately freezes them
into:

```text
anomaly-lightcurve-ml-view-v1
```

and documents the scientific reason.

Do not add them implicitly.

---

# 39. Identity Fields Are Not Features

Do NOT feed:

```text
source_product_id

lineage_id

tic_id

sample_id

sector
```

into the autoencoder.

---

# 40. Catalog Fields Are Not Features

Do NOT feed:

```text
TOI ID

TCE ID

training label

catalog disposition
```

into anomaly V1.

---

# 41. Feature Order

Freeze exact ordered numeric vector in:

```text
ml-anomaly-view-v1.md
```

---

# 42. Feature Order Is Runtime-Semantic

The same order must later be used by:

```text
Python training

ONNX export

Rust inference
```

---

# 43. Anomaly View Fingerprint

Compute deterministic:

```text
SHA256(
    anomaly-lightcurve-ml-view-v1
    +
    exact ordered feature list
    +
    eligibility semantics
    +
    group semantics
)
```

---

# 44. Feature Change

Adding/removing/reordering model inputs requires:

```text
anomaly-lightcurve-ml-view-v2
```

if the durable model input contract changes.

---

# 45. No Feature Selection From Reconstruction Results

Do not train once, inspect anomaly score, then silently drop features while
keeping the same V1 view.

Feature semantics are versioned.

---

# 46. Anomaly Preprocessing Version

Introduce:

```text
anomaly-lightcurve-preprocess-v1
```

---

# 47. TRAIN-Only Preprocessing

Mandatory:

```text
fit preprocessing on TRAIN only
```

VALIDATION:

```text
transform only
```

---

# 48. Numeric Missing Values

For nullable numeric features:

```text
TRAIN median imputation
```

same principle as candidate training.

---

# 49. TRAIN Median

For feature `f`:

```text
median_f =
median(finite TRAIN values)
```

Validation never affects this value.

---

# 50. All-Missing TRAIN Feature

If one required model-view feature has:

```text
100% missing in TRAIN
```

fail:

```text
ALL_MISSING_TRAIN_FEATURE
```

Do not use validation to rescue it.

---

# 51. Standardization

After imputation:

```text
mean_f
std_f
```

fit on TRAIN only.

Transform:

```text
z = (x - mean_f) / scale_f
```

---

# 52. Constant Feature

If:

```text
std_f == 0
```

use:

```text
scale_f = 1
```

and record diagnostic.

---

# 53. Validation Must Not Influence Scaling

Mandatory regression test.

---

# 54. No Robust Scaler V1

Use standardization for V1.

Do not introduce several selectable scaler types.

If scaling semantics change:

```text
anomaly-lightcurve-preprocess-v2
```

---

# 55. No Categorical Encoding

Anomaly LC V1 input should be:

```text
numeric fixed-length vector
```

No one-hot sector/TIC/catalog values.

---

# 56. Preprocessing Artifact

Persist:

```text
preprocessing.json
```

containing:

```text
schema_version

preprocessing_version

feature_names

imputation medians

means

scales

split_id
```

---

# 57. No Label Encoding In Anomaly Artifact

Unlike candidate model, anomaly preprocessing does NOT need:

```text
POSITIVE -> 1
NEGATIVE -> 0
```

because the model is unsupervised.

---

# 58. Score Definition Version

Introduce:

```text
reconstruction-mse-v1
```

---

# 59. Anomaly Score

For transformed input:

```text
x
```

and reconstruction:

```text
x_hat
```

define:

```text
anomaly_score =
mean(
    (x - x_hat)^2
)
```

over the exact ordered model feature vector.

---

# 60. Score Space

Important:

```text
anomaly score is computed in standardized feature space
```

not directly in mixed-unit Gold feature space.

---

# 61. Why Standardized Score

Otherwise features with larger numerical scales could dominate reconstruction
error for purely unit-related reasons.

---

# 62. Score Is Evidence

Freeze terminology:

```text
higher score
    =
larger reconstruction error
```

It means:

```text
more unusual relative to learned TRAIN feature structure
```

It does NOT mean:

```text
scientifically confirmed anomaly
```

---

# 63. No Threshold Yet

Do NOT define:

```text
score > X = anomaly
```

in Phase 6.3.

Phase 6.4 evaluates/finalizes threshold semantics if needed.

---

# 64. No Percentile Threshold Yet

Do not freeze:

```text
top 1%
95th percentile
3 sigma
```

as production behavior here.

You may report score distribution diagnostics only.

---

# 65. Autoencoder Version

Freeze:

```text
anomaly-lightcurve-autoencoder-v1
```

---

# 66. V1 Architecture

Recommended:

```text
input_dim
   |
Linear(input_dim, 32)
   |
ReLU
   |
Linear(32, 8)
   |
ReLU
   |
Linear(8, 32)
   |
ReLU
   |
Linear(32, input_dim)
   |
reconstruction
```

---

# 67. Latent Representation

V1 latent dimension:

```text
8
```

Do not expose latent dimension as a casually mutable runtime parameter while
keeping the same model version.

---

# 68. Small Model Requirement

The model must remain:

```text
CPU-friendly

4 GB VRAM friendly

ONNX-friendly

easy to reproduce
```

---

# 69. No Dropout V1

Recommended:

```text
no dropout
```

for simpler deterministic behavior/runtime parity.

---

# 70. No BatchNorm V1

Recommended:

```text
no BatchNorm
```

This avoids additional running-state semantics and simplifies tiny-dataset
training.

---

# 71. Activation

Use:

```text
ReLU
```

for V1.

---

# 72. Output Activation

Use:

```text
none
```

on reconstruction output.

The network reconstructs standardized real-valued inputs.

---

# 73. Loss

Use:

```text
MSELoss
```

between:

```text
reconstruction
```

and:

```text
standardized input
```

---

# 74. No Classification Loss

Do NOT use:

```text
BCE

cross entropy

TOI labels
```

for anomaly model training.

---

# 75. Optimizer

Recommended:

```text
AdamW
```

---

# 76. Learning Rate

Recommended default:

```text
1e-3
```

Persist actual value.

---

# 77. Weight Decay

Recommended:

```text
1e-5
```

Persist actual value.

---

# 78. Batch Size

Recommended default:

```text
64
```

---

# 79. Maximum Epochs

Recommended:

```text
150
```

as a safety ceiling.

---

# 80. Early Stopping

Use:

```text
VALIDATION reconstruction loss
```

only.

---

# 81. Early-Stopping Patience

Recommended:

```text
15
```

---

# 82. Early-Stopping `min_delta`

Use an explicit small value such as:

```text
1e-5
```

Persist it.

---

# 83. Best Model

Persist:

```text
best validation reconstruction-loss state
```

not blindly the final epoch.

---

# 84. No Golden Test For Early Stopping

Mandatory:

```text
GOLDEN TEST
```

is not loaded in Phase 6.3.

---

# 85. No Recent Holdout

Same for:

```text
RECENT HOLDOUT
```

---

# 86. DataLoader

TRAIN:

```text
shuffle=true
```

using deterministic seeded generator.

VALIDATION:

```text
shuffle=false
```

---

# 87. Training Seed

Require explicit:

```text
training_seed
```

---

# 88. Seed Coverage

Set deterministic seeds for used:

```text
Python random

NumPy

PyTorch
```

---

# 89. Split Seed Is Different

Freeze:

```text
split_seed
    =
group membership
```

```text
training_seed
    =
optimization randomness
```

---

# 90. CPU Reference Mode

Normal automated validation should use:

```text
device=cpu
```

---

# 91. GPU Optional

Support:

```text
device=auto

device=cuda
```

only if existing training-device logic already supports this cleanly.

---

# 92. CPU Fallback

For:

```text
device=auto
```

CUDA absence:

```text
use CPU
```

---

# 93. Explicit CUDA Failure

For:

```text
device=cuda
```

with no CUDA:

```text
fail clearly
```

---

# 94. No GPU Correctness Dependency

The model must not require GPU to:

```text
train

evaluate validation reconstruction

serialize
```

---

# 95. Input Tensor

Use:

```text
float32
```

shape:

```text
[N, input_dim]
```

---

# 96. Output Tensor

Freeze:

```text
[N, input_dim]
```

reconstruction shape.

---

# 97. Score Shape

Per-row anomaly score:

```text
[N]
```

---

# 98. Finite Tensor Invariant

After preprocessing:

```text
NaN = none

+Inf = none

-Inf = none
```

---

# 99. No Whole Historical Dataset Requirement

For current project scale the scalar dataset may fit in memory.

Still avoid coupling correctness to loading arbitrary future history into GPU
memory at once.

---

# 100. Development Metrics

Phase 6.3 should record:

```text
best_train_reconstruction_loss

validation_reconstruction_loss

validation_score_mean

validation_score_median

validation_score_p95

validation_score_max
```

---

# 101. Optional Latent Diagnostics

Do NOT persist giant latent-vector datasets.

At most record small diagnostic statistics if actually useful.

Not required.

---

# 102. No Accuracy

Do NOT report:

```text
accuracy
```

for an unsupervised anomaly model without ground-truth anomaly labels.

---

# 103. No PR-AUC Claim

Do NOT report:

```text
PR-AUC

ROC-AUC
```

as model quality unless Phase 6.4 explicitly introduces a valid labeled or
synthetic evaluation cohort.

---

# 104. No False Scientific Benchmark

Validation reconstruction loss is:

```text
development reconstruction metric
```

not:

```text
astronomical anomaly detection accuracy
```

---

# 105. Score Distribution Only

Phase 6.3 can inspect:

```text
mean

median

p95

max
```

of validation scores.

Do not convert them into a final binary decision.

---

# 106. Training Spec Fingerprint

Compute:

```text
training_spec_fingerprint =
SHA256(
    gold_snapshot_id
    +
    split_id
    +
    anomaly view fingerprint
    +
    anomaly-lightcurve-autoencoder-v1
    +
    anomaly-lightcurve-preprocess-v1
    +
    reconstruction-mse-v1
    +
    training_seed
    +
    canonical hyperparameters
)
```

---

# 107. Operational Config Exclusion

Do not include:

```text
MinIO hostname

log level

temp directory
```

in training-spec fingerprint.

---

# 108. Training Run ID

Create one unique execution identity:

```text
anomaly-run-...
```

Distinct from:

```text
training_spec_fingerprint
```

---

# 109. Training Run Path

Use:

```text
training-runs/
└── anomaly/
    └── <training-run-id>/
        ├── model.pt
        ├── preprocessing.json
        ├── metrics.json
        └── manifest.json
```

Optional:

```text
history.json
```

only if actually useful.

---

# 110. Native Model

Persist:

```text
state_dict
```

plus enough architecture/version metadata to reconstruct:

```text
anomaly-lightcurve-autoencoder-v1
```

---

# 111. Model SHA256

Compute:

```text
model_sha256
```

---

# 112. Preprocessing SHA256

Compute:

```text
preprocessing_sha256
```

---

# 113. Metrics SHA256

Recommended:

```text
metrics_sha256
```

---

# 114. Reuse `training-run-v1`

Phase 6.2 already introduced:

```text
contracts/data/training-run-v1.md
```

Reuse it for:

```text
task=astronomical_anomaly_detection
```

Do NOT create another training-run schema solely for anomaly models.

---

# 115. Training Run Task

Use:

```text
astronomical_anomaly_detection
```

or one equivalent stable task name.

Do NOT call it:

```text
alien_detection
```

---

# 116. Anomaly Training Run Manifest

Persist:

```text
schema_version

training_run_id

training_spec_fingerprint

task

model_version

score_definition_version

gold_snapshot_id

gold_manifest_sha256

split_id

split_manifest_sha256

dataset_view_version

dataset_view_fingerprint

feature_names

preprocessing_version

training_seed

hyperparameters

train_row_count

validation_row_count

best_epoch

device

runtime_versions

model_key

model_sha256

preprocessing_key

preprocessing_sha256

metrics_key

created_at

completed_at
```

---

# 117. No Label Snapshot Requirement In Model Semantics

The anomaly model is not supervised by:

```text
candidate-label snapshot
```

Do not make label policy a model-training dependency.

Gold snapshot may still reference labels globally; anomaly model does not use
them.

---

# 118. Manifest Written Last

Required:

```text
train model
    |
    v
model.pt
    |
    v
preprocessing.json
    |
    v
metrics.json
    |
    v
verify artifacts
    |
    v
training run manifest
```

---

# 119. Partial Run

Without valid:

```text
manifest.json
```

the training run is:

```text
NOT COMMITTED
```

---

# 120. Immutable Completed Run

After manifest commit:

```text
model.pt

preprocessing.json

metrics.json

manifest.json
```

are immutable.

---

# 121. No Registry Package Yet

Do NOT write:

```text
models/anomaly/<model-id>/
```

in Phase 6.3.

Phase 6.5 owns registry model packages.

---

# 122. ML-Training Checkpoint

Reuse Phase 6.2 checkpoint semantics.

Path:

```text
checkpoints/
└── ml-training/
    └── anomaly/
        └── <training-run-id>.json
```

---

# 123. Checkpoint States

Reuse:

```text
PLANNED
    |
    v
TRAINING
    |
    v
ARTIFACT_STORED
    |
    v
COMPLETED
```

Failure:

```text
FAILED
```

---

# 124. Do Not Invent Different State Machine

Candidate and anomaly training run recovery have the same run-level semantics.

Reuse the explicit implementation where appropriate.

---

# 125. Checkpoint Is Recovery State

It is NOT:

```text
model registry

split truth

Gold truth

distributed lock
```

---

# 126. V1 Resume Semantics

No optimizer-state resume required.

Crash during:

```text
TRAINING
```

may restart training from:

```text
epoch 0
```

using same:

```text
Gold
split
preprocessing fit policy
training seed
configuration
```

---

# 127. Why Restart Is Acceptable

The V1 autoencoder is intentionally small.

Do not introduce remote epoch checkpoint complexity without measured need.

---

# 128. ARTIFACT_STORED Recovery

If:

```text
model

preprocessing

metrics
```

exist and verify:

```text
commit run manifest
```

without retraining.

---

# 129. Manifest Repairs Checkpoint

Valid committed run manifest + missing/stale checkpoint:

```text
repair checkpoint -> COMPLETED
```

---

# 130. Checkpoint Is Not Proof

```text
checkpoint=COMPLETED
```

with missing/corrupt run manifest:

```text
not trusted
```

---

# 131. Training CLI

Add:

```bash
python -m aurora_ml.main train-anomaly \
    --snapshot-id <gold-anomaly-snapshot-id> \
    --split-id <anomaly-split-id> \
    --training-seed 42
```

---

# 132. Optional Device

Support existing style:

```text
--device cpu

--device auto

--device cuda
```

---

# 133. CLI Output

Example:

```text
training_run_id:          anomaly-run-...
training_spec:            ...
gold_snapshot_id:         ...
split_id:                 ...

model:                    anomaly-lightcurve-autoencoder-v1
preprocessing:            anomaly-lightcurve-preprocess-v1
score_definition:         reconstruction-mse-v1

features:                 ...

TRAIN:
  groups:                 ...
  rows:                   ...

VALIDATION:
  groups:                 ...
  rows:                   ...

best_epoch:               ...
validation_loss:          ...
validation_score_mean:    ...
validation_score_median:  ...
validation_score_p95:     ...

state:                    COMPLETED
```

---

# 134. No "Detected N Anomalies"

Do not output:

```text
detected 42 anomalies
```

without a frozen threshold/evaluation policy.

Use:

```text
score distribution
```

only.

---

# 135. No Prediction Persistence

Do NOT create:

```text
predictions/
```

during Phase 6.3.

---

# 136. No Row-Level Scores In MinIO Yet

Validation scores may remain:

```text
in memory
```

for metric calculation.

Do not commit them as production anomaly results.

---

# 137. Why No Scores Yet

Durable prediction schema belongs to the inference/prediction serving stage.

Training-run metrics are enough here.

---

# 138. Pure Preprocessing Fit

Preferred:

```python
fit_anomaly_preprocessing(
    train_rows,
    feature_names,
)
```

No MinIO I/O inside the math.

---

# 139. Pure Transform

Preferred:

```python
transform_anomaly_rows(
    rows,
    preprocessing,
)
```

Must never refit.

---

# 140. Pure Score Function

Preferred:

```python
reconstruction_mse(
    input_tensor,
    reconstructed_tensor,
)
```

This definition must later be reused for ONNX/Rust parity.

---

# 141. Model Builder

Preferred:

```python
build_anomaly_model(input_dim)
```

returning:

```text
anomaly-lightcurve-autoencoder-v1
```

---

# 142. Training Loop

Preferred:

```python
train_anomaly_model(...)
```

No MinIO operation inside batch optimization.

---

# 143. Orchestrator

Higher-level `train.py` may:

```text
validate Gold/split

load rows

fit preprocessing

construct tensors

train

validate reconstruction

write artifacts

update checkpoint
```

---

# 144. No Generic Trainer Factory

Do not make candidate/anomaly training share a giant polymorphic framework.

Small low-level helpers may be reused only where semantics are truly identical:

```text
artifact hashing

checkpoint object I/O

seed initialization
```

---

# 145. Candidate/Anomaly Preprocessing

Do NOT automatically force them into one ambiguous:

```text
preprocess_ml()
```

Their version identities are different:

```text
candidate-preprocess-v1

anomaly-lightcurve-preprocess-v1
```

---

# 146. No Global `utils.py`

Keep anomaly math in:

```text
anomaly/train.py

anomaly/model.py
```

or existing clear ownership modules.

---

# 147. Model Input Integrity

Before training:

```text
input_dim
==
len(feature_names)
```

---

# 148. Reconstruction Integrity

For every batch:

```text
reconstruction.shape
==
input.shape
```

---

# 149. Score Integrity

Every validation row gets exactly:

```text
one finite reconstruction score
```

---

# 150. No Negative Score

MSE score must satisfy:

```text
score >= 0
```

within numerical tolerance.

---

# 151. Model Output Is Reconstruction

Do not make V1 ONNX-facing semantics:

```text
single anomaly probability
```

The model reconstructs input.

Later runtime computes:

```text
reconstruction-mse-v1
```

---

# 152. Why No Probability

Unsupervised reconstruction error is not inherently calibrated to:

```text
P(anomaly)
```

Do not mislabel it.

---

# 153. Unit Test — Dataset View Feature List

Verify exact:

```text
anomaly-lightcurve-ml-view-v1
```

feature order.

---

# 154. Unit Test — Identity Exclusion

Verify no:

```text
tic_id

sector

source_product_id

sample_id
```

appears in model tensor.

---

# 155. Unit Test — Label Independence

Provide same LC Gold features with different external candidate label metadata.

Expected:

```text
same anomaly input vector
```

---

# 156. Unit Test — BLS Exclusion

If V1 contract excludes BLS:

```text
bls_period

bls_depth

bls_power
```

must not appear in anomaly feature vector.

---

# 157. Unit Test — Group Key TIC

Same as Phase 6.1 target grouping.

---

# 158. Unit Test — Multi-Sector TIC

```text
TIC 123 sector 10
TIC 123 sector 11
```

must stay in the same anomaly split.

---

# 159. Unit Test — Split Determinism

Same:

```text
Gold
view
policy
seed
```

produces same assignments.

---

# 160. Unit Test — Cumulative Membership

Existing groups retain split membership across cumulative anomaly Gold snapshots.

---

# 161. Unit Test — No Label Influence On Split

Changing candidate label metadata does not move the TIC between TRAIN and
VALIDATION.

---

# 162. Unit Test — Train Median

Known TRAIN values.

Verify exact imputation median.

---

# 163. Unit Test — Validation Median Leakage

Extreme validation values must not affect TRAIN median.

---

# 164. Unit Test — All Missing TRAIN

Expected:

```text
ALL_MISSING_TRAIN_FEATURE
```

---

# 165. Unit Test — Standardization

Verify:

```text
mean
scale
transformed values
```

from TRAIN only.

---

# 166. Unit Test — Validation Scale Leakage

Validation changes must not affect preprocessing parameters.

---

# 167. Unit Test — Constant Feature

Expected:

```text
scale=1
```

policy.

---

# 168. Unit Test — Preprocessing Serialization

Round-trip:

```text
feature order

medians

means

scales

preprocessing version

split ID
```

---

# 169. Unit Test — No Label Encoding

Anomaly preprocessing artifact should not contain candidate binary label
mapping unless a shared serialization contract requires an explicitly unused
field.

Preferred:

```text
no label encoding field
```

---

# 170. Unit Test — Finite Preprocessing

After transform:

```text
no NaN

no Inf
```

---

# 171. Unit Test — Autoencoder Shape

Input:

```text
[4, input_dim]
```

Expected reconstruction:

```text
[4, input_dim]
```

---

# 172. Unit Test — Finite Reconstruction

Deterministic finite input:

```text
finite output
```

---

# 173. Unit Test — Score Exactness

Example:

```text
x     = [0, 2]
x_hat = [0, 0]
```

Expected:

```text
score = (0^2 + 2^2) / 2 = 2
```

---

# 174. Unit Test — Score Nonnegative

Mandatory.

---

# 175. Unit Test — Score Per Row

Batch score shape:

```text
[N]
```

---

# 176. Unit Test — Score Version

Training metadata records:

```text
reconstruction-mse-v1
```

---

# 177. Unit Test — Model Version

Artifact records:

```text
anomaly-lightcurve-autoencoder-v1
```

---

# 178. Unit Test — Preprocessing Version

Artifact records:

```text
anomaly-lightcurve-preprocess-v1
```

---

# 179. Unit Test — Loss Improvement

Train on a tiny structured synthetic inlier dataset.

Expected:

```text
reconstruction loss decreases
```

---

# 180. Unit Test — Early Stopping

Controlled no-improvement case respects:

```text
patience
min_delta
```

---

# 181. Unit Test — Best Epoch Restore

Final persisted model corresponds to best validation reconstruction loss.

---

# 182. Unit Test — Training Seed

Same seed/config in CPU test produces reproducible training behavior within
frozen tolerance.

---

# 183. Unit Test — Seed Change

Changing training seed changes:

```text
training_spec_fingerprint
```

---

# 184. Unit Test — Hyperparameter Change

Changing:

```text
learning_rate
```

changes training-spec fingerprint.

---

# 185. Unit Test — Score Definition Change

Simulated:

```text
reconstruction-mae-v2
```

must change training specification/model runtime semantics.

Do not silently change score formula under V1.

---

# 186. Unit Test — Operational Config Independence

Changing:

```text
log level

MinIO endpoint
```

does not change training-spec fingerprint.

---

# 187. Unit Test — No Labels In Loss

Inject arbitrary candidate labels.

Loss must remain identical for the same numeric batch/model state.

---

# 188. Unit Test — Validation Score Summary

Known score vector.

Verify:

```text
mean

median

p95

max
```

---

# 189. Unit Test — No Threshold

Ensure training artifacts do NOT contain:

```text
anomaly_threshold
```

---

# 190. Synthetic Outlier Mechanical Test

Train a tiny autoencoder on simple clustered synthetic TRAIN data.

Compare:

```text
normal-like validation point

extreme synthetic point
```

Expected:

```text
extreme point generally receives higher reconstruction error
```

Use this only as a mechanical sanity test.

Do NOT claim astronomical benchmark performance from it.

---

# 191. No Synthetic Outliers In Training

The mechanical outlier fixture is evaluation/test-only.

Do not inject it into TRAIN.

---

# 192. Unit Test — Training Run Manifest

Round-trip anomaly run through:

```text
training-run-v1
```

---

# 193. Unit Test — Task Field

Expected:

```text
task=astronomical_anomaly_detection
```

---

# 194. Unit Test — No Label Policy Dependency

Anomaly run manifest should not imply candidate-label policy is part of
anomaly loss semantics.

---

# 195. Unit Test — Artifact SHA

Verify:

```text
model SHA

preprocessing SHA

metrics SHA
```

---

# 196. Unit Test — Checkpoint Serialization

Reuse:

```text
PLANNED

TRAINING

ARTIFACT_STORED

COMPLETED

FAILED
```

---

# 197. Unit Test — Checkpoint Recovery

Valid run manifest repairs stale/missing checkpoint.

---

# 198. Unit Test — Checkpoint Not Proof

`COMPLETED` checkpoint with missing run manifest:

```text
not trusted
```

---

# 199. Integration — Stage 5 Anomaly Gold

Use a committed:

```text
gold-anomaly-v1
```

fixture.

Build:

```text
anomaly-lightcurve-ml-view-v1
```

---

# 200. Integration — Anomaly Split

Create/reuse deterministic:

```text
anomaly-group-split-v1
```

split manifest.

Verify target disjointness.

---

# 201. Integration — Train Anomaly

Flow:

```text
Gold anomaly snapshot
      |
      v
anomaly split
      |
      v
TRAIN-only preprocessing
      |
      v
autoencoder
      |
      v
validation reconstruction
      |
      v
COMPLETED run
```

---

# 202. Integration — Gold-Only Access

Instrument storage.

During entire training:

```text
Bronze reads = 0

Silver reads = 0
```

Mandatory.

---

# 203. Integration — ClickHouse Offline

Stop ClickHouse.

Training succeeds.

---

# 204. Integration — NATS Offline

Stop NATS.

Training succeeds.

---

# 205. Integration — No Network

Disable external network.

Training succeeds.

---

# 206. Integration — CPU Only

CUDA hidden/unavailable.

Training succeeds.

---

# 207. Integration — RAW_DELETED Provenance

Use Gold derived from Stage 4 state where Bronze has been safely evicted.

Training succeeds with no special-case code.

---

# 208. Integration — Candidate Label Change

Create equivalent anomaly Gold numeric features with different candidate label
state elsewhere.

Expected anomaly model input data unchanged.

---

# 209. Integration — Validation Leakage

Change validation feature distribution drastically.

Expected:

```text
TRAIN preprocessing parameters unchanged
```

Training best epoch may change because validation loss changes; that is valid.

---

# 210. Integration — Same Training Specification

Two independent CPU runs with:

```text
same Gold

same split

same view

same model/preprocessing versions

same hyperparameters

same training seed
```

Expected:

```text
same training_spec_fingerprint
```

and reproducible behavior within documented tolerance.

---

# 211. Integration — Different Training Seed

Expected:

```text
same split

different training spec fingerprint
```

No membership change.

---

# 212. Integration — Cumulative Gold

Train against:

```text
Gold anomaly snapshot A
```

then:

```text
Gold anomaly snapshot B
```

Existing groups keep deterministic split membership.

Training specification changes because:

```text
gold_snapshot_id changes
```

---

# 213. Crash Test — PLANNED

Crash after:

```text
PLANNED
```

Restart.

Expected normal training.

---

# 214. Crash Test — TRAINING

Kill during optimization.

Restart same run.

Expected:

```text
restart from epoch 0
```

No optimizer-state resume required.

---

# 215. Crash Test — Model Written Only

Partial artifact set:

```text
run remains uncommitted
```

V1 may restart training.

---

# 216. Crash Test — All Artifacts Before Checkpoint

If final exact artifact set exists and verifies:

```text
recover without unnecessary retraining
```

where implementation can prove completeness.

---

# 217. Crash Test — ARTIFACT_STORED Before Manifest

Mandatory:

```text
verify artifacts

commit manifest

COMPLETED
```

---

# 218. Crash Test — Manifest Before COMPLETED

Mandatory:

```text
manifest truth
    ->
repair checkpoint
```

No retraining.

---

# 219. MinIO Model Upload Failure

Expected:

```text
no committed anomaly training run

checkpoint FAILED
```

Gold/split unchanged.

---

# 220. MinIO Manifest Failure

Artifacts may exist.

Without manifest:

```text
run uncommitted
```

Recovery is possible.

---

# 221. Committed Model Corruption

Modify:

```text
model.pt
```

after committed manifest.

Expected:

```text
TRAINING_ARTIFACT_INTEGRITY_ERROR
```

No silent same-ID repair.

---

# 222. Preprocessing Corruption

Same behavior.

---

# 223. Metrics Corruption

Same behavior.

---

# 224. No Gold Mutation

Record Gold hashes before training.

After:

```text
all identical
```

---

# 225. No Split Mutation

Split manifest SHA remains unchanged.

---

# 226. Output Mutation Scope

Phase 6.3 may write:

```text
manifests/ml-splits/
    # only new anomaly split manifests

checkpoints/ml-training/anomaly/

training-runs/anomaly/
```

It must NOT mutate:

```text
Bronze

Silver

Gold

catalogs

labels

lineage

feature-engineering checkpoints

lifecycle checkpoints
```

---

# 227. No Candidate Training Mutation

Do not modify committed:

```text
training-runs/candidate/
```

---

# 228. No Model Registry Yet

Do not create:

```text
models/anomaly/<model-id>/
```

---

# 229. No Champion

Do not create/update:

```text
models/anomaly/champion.json
```

---

# 230. No Challenger Promotion

Training run completion does not imply promotion eligibility.

---

# 231. No ONNX Export

Do not call:

```text
export_onnx.py
```

for final registry/runtime artifact yet.

Phase 6.6 owns ONNX parity.

---

# 232. No Rust Inference Changes

Do not modify:

```text
apps/rust-inference/
```

in Phase 6.3.

---

# 233. No Durable Predictions

Do not create:

```text
predictions/
```

---

# 234. No Prediction Contract

Do not introduce:

```text
prediction-v1.md
```

yet.

---

# 235. No Prediction NATS Event

No:

```text
aurora.v1.anomaly.prediction.ready
```

---

# 236. No API Changes

Go API does not serve learned anomaly scores yet.

---

# 237. No Dashboard Changes

Do not wire anomaly model output into React yet.

---

# 238. No Golden Test

Do not create/freeze final benchmark in Phase 6.3.

---

# 239. No Recent Holdout

Deferred to Phase 6.4.

---

# 240. No Final Threshold

Deferred to Phase 6.4.

---

# 241. No Promotion Comparison

Deferred to Phase 6.5.

---

# 242. Documentation

Update:

```text
docs/ML_TRAINING.md
```

Add:

```text
anomaly-lightcurve-ml-view-v1

anomaly-group-split-v1

anomaly-lightcurve-preprocess-v1

anomaly-lightcurve-autoencoder-v1

reconstruction-mse-v1

unsupervised training semantics

no threshold yet
```

---

# 243. Keep Documentation Consolidated

Do NOT add:

```text
docs/ML_ANOMALY.md
```

unless `ML_TRAINING.md` has genuinely become too large/confusing.

Prefer current ownership structure first.

---

# 244. Update ML_DATASETS.md

Document:

```text
candidate supervised view
    !=
anomaly unsupervised view
```

and anomaly grouping semantics.

---

# 245. Update CHECKPOINTS.md

Confirm:

```text
checkpoints/ml-training/
├── candidate/
└── anomaly/
```

share run-level checkpoint semantics.

---

# 246. Update CONFIGURATION.md

Document only implemented anomaly training settings.

Potential:

```text
default anomaly batch size

learning rate

weight decay

epochs

patience

device
```

Avoid dead options.

---

# 247. Python README

Add:

```text
Gold anomaly LC
      |
      v
anomaly ML view
      |
      v
target-safe split
      |
      v
TRAIN-only preprocessing
      |
      v
autoencoder
      |
      v
reconstruction-error evidence
```

---

# 248. Contracts README

Add:

```text
ml-anomaly-view-v1
```

and note reuse of:

```text
ml-split-v1

training-run-v1
```

---

# 249. STRUCTURE.md

Reflect actual changes only.

Likely no new Python module beyond existing:

```text
anomaly/model.py

anomaly/train.py
```

unless implementation genuinely needs one.

---

# 250. Suggested Tests

Extend/create:

```text
tests/test_anomaly_training.py
```

Reuse:

```text
test_splits.py

test_training_checkpoint.py
```

where semantics are shared.

---

# 251. Do Not Duplicate Checkpoint Tests Excessively

Candidate/anomaly checkpoint state machine is the same.

Add anomaly-specific path/task assertions rather than copy hundreds of tests.

---

# 252. CI Fixture Scale

Use tiny deterministic Gold anomaly fixture.

No real NASA access.

No giant tensors.

---

# 253. CI Epoch Count

Tests may use:

```text
max_epochs=3..10
```

to prove behavior quickly.

Production defaults may remain larger.

---

# 254. Model Quality Is Not Frozen Yet

Phase 6.3 validates:

```text
training correctness

data leakage boundaries

score definition

reproducibility

durable run lifecycle
```

not final scientific model quality.

---

# 255. Phase 6.4 Handoff

Phase 6.4 receives committed:

```text
candidate training runs

anomaly training runs
```

and introduces:

```text
fixed golden test

recent holdout

candidate final metrics

anomaly synthetic/holdout evaluation

threshold evaluation
```

---

# 256. Anomaly Evaluation Handoff

Phase 6.4 can later evaluate:

```text
clean/reference holdout

synthetic injected outliers

score stability

false-alert behavior

score distribution drift
```

without changing the Phase 6.3 training semantics.

---

# 257. Runtime Handoff

Later Phase 6.6 will need exact:

```text
feature order

TRAIN medians

TRAIN means

TRAIN scales

autoencoder architecture

reconstruction-mse-v1
```

Therefore all are durable now.

---

# 258. Future TPF Model

If later desired:

```text
anomaly-tpf-autoencoder-v1
```

must have its own:

```text
dataset view

feature order

preprocessing version

model version
```

Do not piggyback silently on LC model semantics.

---

# 259. Future FFI Model

Same rule.

Never feed full-frame FFI tensors merely because GPU exists.

---

# 260. Core Invariants

Invariant 1:

```text
Phase 6.3 consumes an explicit COMMITTED Gold anomaly snapshot.
```

Invariant 2:

```text
Phase 6.3 performs zero Bronze reads.
```

Invariant 3:

```text
Phase 6.3 performs zero Silver reads.
```

Invariant 4:

```text
ClickHouse is not required for anomaly training correctness.
```

Invariant 5:

```text
No live catalog state is consulted.
```

Invariant 6:

```text
Anomaly model V1 is unsupervised.
```

Invariant 7:

```text
Candidate labels never enter anomaly loss.
```

Invariant 8:

```text
Same TIC never crosses TRAIN / VALIDATION.
```

Invariant 9:

```text
Anomaly split assignment is deterministic at target-group level.
```

Invariant 10:

```text
Anomaly V1 trains from Gold LC scalar evidence, not raw arrays.
```

Invariant 11:

```text
Identity/catalog fields are not anomaly model inputs.
```

Invariant 12:

```text
Feature order is explicit and versioned.
```

Invariant 13:

```text
Imputation is fit on TRAIN only.
```

Invariant 14:

```text
Scaling is fit on TRAIN only.
```

Invariant 15:

```text
Validation never influences preprocessing parameters.
```

Invariant 16:

```text
Anomaly score is reconstruction MSE in standardized feature space.
```

Invariant 17:

```text
Anomaly score is not a calibrated probability.
```

Invariant 18:

```text
Phase 6.3 does not freeze an anomaly threshold.
```

Invariant 19:

```text
Golden test is not accessed.
```

Invariant 20:

```text
Recent holdout is not accessed.
```

Invariant 21:

```text
Training-run artifacts are immutable after manifest commit.
```

Invariant 22:

```text
ML-training checkpoint is recovery state, not model registry truth.
```

Invariant 23:

```text
CPU correctness is mandatory.
```

Invariant 24:

```text
GPU remains optional.
```

Invariant 25:

```text
TPF/FFI learned anomaly models are not mandatory V1 scope.
```

Invariant 26:

```text
Phase 6.3 does not promote/export/serve the model.
```

Invariant 27:

```text
A high reconstruction error is anomaly evidence, not scientific confirmation.
```

---

# Definition of Done

Phase 6.3 is COMPLETE when:

* [x] V1 mandatory anomaly task is explicitly light-curve scalar anomaly detection.
* [x] `anomaly-lightcurve-autoencoder-v1` is defined.
* [x] No mandatory TPF autoencoder is introduced.
* [x] No mandatory FFI autoencoder is introduced.
* [x] Anomaly training accepts explicit Gold anomaly snapshot ID.
* [x] Anomaly training accepts explicit anomaly split ID.
* [x] Anomaly training accepts explicit training seed.
* [x] Gold snapshot must be COMMITTED.
* [x] Gold anomaly schema is validated.
* [x] Gold artifact integrity is validated.
* [x] Only the Gold anomaly lightcurve component is used for V1 learned anomaly training.
* [x] Phase 6.3 reads zero Bronze objects.
* [x] Phase 6.3 reads zero Silver objects.
* [x] Phase 6.3 works after Bronze `RAW_DELETED`.
* [x] ClickHouse is not required.
* [x] NATS is not required.
* [x] Go API is not required.
* [x] Dashboard is not required.
* [x] External network is not required.
* [x] No live TIC call occurs.
* [x] No live TOI call occurs.
* [x] No live TCE call occurs.
* [x] Candidate label values are not used for anomaly training.
* [x] TOI/TCE disposition is not used for anomaly training.
* [x] `anomaly-lightcurve-ml-view-v1` exists.
* [x] `contracts/data/ml-anomaly-view-v1.md` exists.
* [x] Anomaly ML view has explicit ordered numeric feature list.
* [x] Generic LC statistics are preferred over label/catalog metadata.
* [x] Identity fields are excluded from anomaly tensor.
* [x] TIC ID is excluded from anomaly tensor.
* [x] Sector is excluded from anomaly tensor.
* [x] Source product ID is excluded from anomaly tensor.
* [x] Candidate label is excluded from anomaly tensor.
* [x] TOI/TCE identifiers are excluded from anomaly tensor.
* [x] BLS fields follow the explicitly frozen V1 anomaly-view policy.
* [x] Anomaly view fingerprint is deterministic.
* [x] Feature change/reorder changes view identity.
* [x] Existing `ml-split-v1` is reused for anomaly split manifests where compatible.
* [x] `anomaly-group-split-v1` exists.
* [x] Anomaly grouping uses TIC when available.
* [x] Missing TIC uses stable source-product fallback.
* [x] Same TIC across sectors remains in one split.
* [x] Anomaly split uses TRAIN / VALIDATION only.
* [x] Golden test is not defined in Phase 6.3.
* [x] Recent holdout is not defined in Phase 6.3.
* [x] Group assignments use deterministic SHA-based semantics.
* [x] Input ordering does not affect anomaly split.
* [x] Cumulative Gold preserves existing group membership.
* [x] Candidate label changes do not change anomaly group assignment.
* [x] Anomaly split manifest is immutable.
* [x] Anomaly split manifest is stored under `manifests/ml-splits/`.
* [x] `anomaly-lightcurve-preprocess-v1` exists.
* [x] Numeric missing values use TRAIN median imputation.
* [x] Validation values do not influence medians.
* [x] All-missing TRAIN feature fails clearly.
* [x] Standardization parameters use TRAIN only.
* [x] Validation values do not influence mean/scale.
* [x] Constant-feature scale policy is deterministic.
* [x] No categorical encoder is introduced for V1.
* [x] Preprocessing artifact preserves exact feature order.
* [x] Preprocessing artifact preserves medians.
* [x] Preprocessing artifact preserves means.
* [x] Preprocessing artifact preserves scales.
* [x] Preprocessing artifact references exact split ID.
* [x] Preprocessing artifact is immutable after run commit.
* [x] Transformed tensors contain no NaN/Inf.
* [x] Model input tensors use float32.
* [x] `anomaly-lightcurve-autoencoder-v1` architecture is implemented in `anomaly/model.py`.
* [x] Autoencoder input dimension equals feature count.
* [x] Autoencoder reconstruction dimension equals feature count.
* [x] Architecture uses small bounded layers.
* [x] V1 architecture uses explicit ReLU semantics.
* [x] No mandatory Dropout exists.
* [x] No mandatory BatchNorm exists.
* [x] `MSELoss` is used.
* [x] Candidate classification losses are not used.
* [x] AdamW or chosen explicit optimizer is documented.
* [x] Learning rate is explicit.
* [x] Weight decay is explicit.
* [x] Batch size is explicit.
* [x] Maximum epochs are bounded.
* [x] Early stopping exists.
* [x] Early stopping uses VALIDATION reconstruction loss.
* [x] Golden test never affects early stopping.
* [x] Best epoch is recorded.
* [x] Best validation reconstruction state is stored.
* [x] CPU training works.
* [x] GPU is optional.
* [x] `device=auto` falls back to CPU.
* [x] Explicit unavailable CUDA request fails clearly.
* [x] Model comfortably fits 4 GB VRAM.
* [x] Training seed initializes relevant randomness.
* [x] Split seed and training seed remain distinct.
* [x] TRAIN DataLoader shuffling is deterministic.
* [x] VALIDATION DataLoader does not shuffle.
* [x] `reconstruction-mse-v1` exists.
* [x] Score is computed in standardized feature space.
* [x] Score formula is exactly documented.
* [x] One finite score is computed per validation row.
* [x] Score is always nonnegative within numerical tolerance.
* [x] Score is not called a probability.
* [x] Score is not called scientific ground truth.
* [x] No final anomaly threshold is defined.
* [x] No percentile threshold is frozen.
* [x] Validation reconstruction loss is recorded.
* [x] Validation anomaly-score mean is recorded.
* [x] Validation anomaly-score median is recorded.
* [x] Validation anomaly-score p95 is recorded.
* [x] Validation anomaly-score max is recorded.
* [x] Accuracy is not reported as anomaly quality.
* [x] PR-AUC/ROC-AUC are not falsely reported without a valid labeled evaluation set.
* [x] Training-spec fingerprint is deterministic.
* [x] Gold snapshot ID participates in training-spec fingerprint.
* [x] Split ID participates in training-spec fingerprint.
* [x] Anomaly view fingerprint participates in training-spec fingerprint.
* [x] Model version participates in training-spec fingerprint.
* [x] Preprocessing version participates in training-spec fingerprint.
* [x] Score-definition version participates in training-spec fingerprint.
* [x] Training seed participates in training-spec fingerprint.
* [x] Model-affecting hyperparameters participate in training-spec fingerprint.
* [x] Operational log/storage settings do not affect training-spec fingerprint.
* [x] Concrete anomaly training run gets unique training-run ID.
* [x] Training-run ID is distinct from training-spec fingerprint.
* [x] `training-runs/anomaly/<training-run-id>/` exists.
* [x] Native `model.pt` is written.
* [x] Model SHA256 is persisted.
* [x] `preprocessing.json` is written.
* [x] Preprocessing SHA256 is persisted.
* [x] `metrics.json` is written.
* [x] Metrics are clearly development reconstruction metrics.
* [x] Training-run manifest uses `training-run-v1`.
* [x] Training run task is explicitly astronomical anomaly detection.
* [x] Training-run manifest references exact Gold snapshot.
* [x] Training-run manifest references Gold manifest SHA.
* [x] Training-run manifest references exact split.
* [x] Training-run manifest references split manifest SHA.
* [x] Training-run manifest references anomaly-view version/fingerprint.
* [x] Training-run manifest records feature order.
* [x] Training-run manifest records model version.
* [x] Training-run manifest records preprocessing version.
* [x] Training-run manifest records score-definition version.
* [x] Training-run manifest records training seed.
* [x] Training-run manifest records hyperparameters.
* [x] Training-run manifest records TRAIN/VALIDATION counts.
* [x] Training-run manifest records best epoch.
* [x] Training-run manifest records runtime/device information.
* [x] Training-run manifest is written last.
* [x] Training-run manifest is immutable.
* [x] Partial artifact directory without manifest is not a committed run.
* [x] `checkpoints/ml-training/anomaly/` exists.
* [x] Anomaly training reuses ML-training checkpoint state semantics.
* [x] `PLANNED` works.
* [x] `TRAINING` works.
* [x] `ARTIFACT_STORED` works.
* [x] `COMPLETED` works.
* [x] `FAILED` works.
* [x] Training checkpoint is written before expensive training.
* [x] Checkpoint failure before training stops the run.
* [x] Mid-training crash may restart from epoch zero.
* [x] V1 does not require optimizer-state resume.
* [x] ARTIFACT_STORED recovery commits manifest without retraining.
* [x] Valid run manifest repairs missing/stale checkpoint.
* [x] COMPLETED checkpoint without valid run manifest is not trusted.
* [x] Committed model corruption is detected.
* [x] Committed preprocessing corruption is detected.
* [x] Committed metrics corruption is detected.
* [x] Gold is never mutated.
* [x] Split manifest is never mutated.
* [x] Candidate training runs are never mutated.
* [x] Dataset-view feature-list test passes.
* [x] Identity-feature exclusion tests pass.
* [x] Candidate-label independence test passes.
* [x] Multi-sector target split test passes.
* [x] Split determinism test passes.
* [x] Cumulative membership test passes.
* [x] TRAIN median test passes.
* [x] Validation median-leakage test passes.
* [x] TRAIN-only scaling test passes.
* [x] Validation scaling-leakage test passes.
* [x] Constant-feature test passes.
* [x] Preprocessing serialization test passes.
* [x] Finite preprocessing test passes.
* [x] Autoencoder shape test passes.
* [x] Autoencoder finite-output test passes.
* [x] Reconstruction MSE exactness test passes.
* [x] Score nonnegative test passes.
* [x] Score-shape test passes.
* [x] Loss-improvement test passes.
* [x] Early-stopping test passes.
* [x] Best-epoch restore test passes.
* [x] Training-seed reproducibility test passes.
* [x] Training-spec fingerprint tests pass.
* [x] No-label-in-loss test passes.
* [x] Validation score-summary test passes.
* [x] No-threshold-artifact test passes.
* [x] Synthetic outlier mechanical sanity test passes without being presented as science accuracy.
* [x] Training-run manifest tests pass.
* [x] Artifact checksum tests pass.
* [x] Checkpoint serialization/recovery tests pass.
* [x] Stage 5 anomaly Gold integration test passes.
* [x] Anomaly deterministic split integration test passes.
* [x] Gold-only access integration test passes.
* [x] ClickHouse-offline training test passes.
* [x] NATS-offline training test passes.
* [x] network-offline training test passes.
* [x] CPU-only training test passes.
* [x] RAW_DELETED-derived Gold training test passes.
* [x] crash-after-PLANNED recovery passes.
* [x] crash-during-TRAINING recovery passes.
* [x] crash-after-artifacts-before-manifest recovery passes.
* [x] crash-after-manifest-before-COMPLETED recovery passes.
* [x] MinIO artifact failure is safe.
* [x] MinIO manifest failure leaves run uncommitted.
* [x] `train-anomaly` CLI command exists or equivalent clean command.
* [x] CLI does not report a binary anomaly count without a threshold.
* [x] No final anomaly predictions are persisted.
* [x] No `predictions/` objects are created.
* [x] No registry model is created.
* [x] No champion pointer is changed.
* [x] No challenger is promoted.
* [x] No ONNX is exported.
* [x] Rust inference remains unchanged.
* [x] No prediction NATS event exists.
* [x] No Go API ML change exists.
* [x] No dashboard ML change exists.
* [x] `docs/ML_TRAINING.md` documents anomaly training semantics.
* [x] `docs/ML_DATASETS.md` distinguishes candidate and anomaly views.
* [x] `docs/CHECKPOINTS.md` documents candidate/anomaly ML-training ownership.
* [x] `docs/CONFIGURATION.md` documents only implemented anomaly settings.
* [x] Python README documents anomaly-training flow.
* [x] Contracts README documents `ml-anomaly-view-v1`.
* [x] STRUCTURE.md matches actual files.
* [x] Existing Stage 5, Phase 6.1 and Phase 6.2 tests remain green.
* [x] Repository is ready for Phase 6.4.

---

# Out of Scope

Do NOT implement in Phase 6.3:

* full light-curve tensor autoencoder
* 1D convolutional anomaly model
* TPF CNN
* FFI CNN
* giant FFI tensors
* Silver-array training
* Bronze/FITS training
* label-supervised anomaly classifier
* TOI-driven anomaly cohort filtering
* TCE-driven anomaly cohort filtering
* anomaly probability calibration
* final anomaly threshold
* percentile alert threshold
* golden test evaluation
* recent holdout evaluation
* scientific false-alert benchmark
* production anomaly score persistence
* prediction schema
* candidate-vetting final evaluation
* model comparison
* champion/challenger promotion
* model registry packaging
* rollback
* ONNX export
* Rust inference parity
* inference checkpoint
* prediction NATS events
* Go API anomaly prediction endpoints
* React anomaly prediction UI
* scientific anomaly confirmation

---

# Next

```text
Stage 6 — Machine Learning Training, Evaluation & Model Registry

Phase 6.1  ML Dataset View & Deterministic Group Split        [DONE]

Phase 6.2  Candidate Vetting Model Training                   [DONE]

Phase 6.3  Astronomical Anomaly Detection Training            [DONE]

Phase 6.4  Evaluation — Golden Test & Recent Holdout
```

```
```
