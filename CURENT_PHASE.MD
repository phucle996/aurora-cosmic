````md
# CHECKLIST_PHASE_6_2.md

# Stage 6 — Machine Learning Training, Evaluation & Model Registry
## Phase 6.2 — Candidate Vetting Model Training

Status: TODO

Goal:

> Train the first reproducible AURORA exoplanet-candidate vetting model from
> one explicit immutable Gold snapshot and one explicit immutable ML split.
>
> Phase 6.2 introduces:
>
> - train-only preprocessing,
> - candidate tabular model V1,
> - deterministic training configuration,
> - training-run manifests,
> - ML-training recovery checkpoints,
> - durable native model artifacts,
> - development validation metrics.
>
> The model answers:
>
>     "How strong is the evidence that this Gold candidate resembles the
>      POSITIVE catalog-derived training class?"
>
> It does NOT:
>
> - scientifically confirm a planet,
> - query live TOI/TCE catalogs,
> - train from Silver or Bronze,
> - use UNRESOLVED rows as negatives,
> - use the future golden test for tuning,
> - promote itself to champion,
> - export ONNX yet.
>
> Canonical training input:
>
>     Gold snapshot ID
>          +
>     ML split ID
>
> not:
>
>     ClickHouse latest rows
>     Silver scans
>     Bronze FITS
>     live catalogs.

---

# 1. Phase Input

Required:

```text
gold_snapshot_id
+
split_id
+
candidate-ml-view-v1
+
candidate-group-split-v1
+
explicit training configuration
+
explicit training_seed
````

---

# 2. Canonical Flow

Freeze:

```text
Committed Gold
      |
      v
candidate-ml-view-v1
      |
      v
immutable split manifest
      |
      +---------------------+
      |                     |
      v                     v
    TRAIN                VALIDATION
      |                     |
      v                     |
fit preprocessing           |
      |                     |
      v                     |
train model                 |
      |                     |
      +----------+----------+
                 |
                 v
       development validation
                 |
                 v
       immutable training run
```

---

# 3. Gold-Only Training

Normal training reads:

```text
gold/snapshots/<gold-snapshot-id>/
```

and:

```text
manifests/ml-splits/<split-id>.json
```

Expected:

```text
Bronze reads = 0
Silver reads = 0
```

---

# 4. ClickHouse Is Not Training Truth

Do NOT train with:

```sql
SELECT *
FROM candidate_features_v1
WHERE snapshot_id = ...
```

as the canonical V1 training path.

ClickHouse remains useful for:

```text
exploration
diagnostics
analytics
```

Canonical training data remains:

```text
Gold Parquet
```

---

# 5. ClickHouse Loss Must Not Break Training

Mandatory:

```text
ClickHouse unavailable
        |
        X
        |
Gold + split manifest
        |
        v
candidate training succeeds
```

---

# 6. No Catalog Network

Phase 6.2 performs:

```text
TIC live calls = 0
TOI live calls = 0
TCE live calls = 0
```

Labels are already frozen in Gold.

---

# 7. No NATS Requirement

Candidate training is a batch operation.

Do not require:

```text
JetStream
```

for model correctness.

No training event is needed.

---

# 8. Python Ownership

Candidate training remains in:

```text
apps/python-ml-worker/
```

Primary existing ownership:

```text
aurora_ml/transit/
├── model.py
└── train.py
```

Use these files.

---

# 9. Module Responsibilities

Recommended:

```text
transit/model.py
    candidate neural-network definition

transit/train.py
    preprocessing fit
    training loop
    validation
    training-run orchestration
```

Add only one new module if justified:

```text
training_checkpoint.py
```

for:

```text
checkpoints/ml-training/
```

---

# 10. Do Not Build a Training Framework

Do NOT create:

```text
trainer_factory.py
experiment_manager.py
model_strategy.py
training_engine.py
ml_platform/
```

One candidate trainer is enough.

---

# 11. Candidate Model V1

Freeze primary V1 model:

```text
candidate-tabular-mlp-v1
```

Input:

```text
fixed ordered numeric feature vector
```

Output:

```text
one binary logit
```

---

# 12. Why Tabular V1

Current Gold already contains compact scientific evidence:

```text
LC statistics
BLS evidence
TPF evidence
TIC stellar context
```

Therefore V1 should train directly from:

```text
gold-candidate-v1
```

Do NOT reintroduce raw time-series dependencies just to train a CNN.

---

# 13. CNN Is Not V1 Critical Path

Do NOT make Phase 6.2 depend on:

```text
1D LC CNN
TPF CNN
```

A future challenger may derive tensor datasets explicitly.

For V1:

```text
Gold scalar features
    ->
tabular model
```

---

# 14. Optional Baseline

A simple:

```text
logistic regression
```

may be used manually as a diagnostic baseline.

It is NOT required for Phase 6.2 completion.

Do not introduce another full framework merely for a baseline.

---

# 15. PyTorch

Use the existing Python ML stack.

Recommended:

```text
PyTorch
```

for:

```text
candidate-tabular-mlp-v1
```

because later:

```text
PyTorch
    ->
ONNX
    ->
Rust ONNX Runtime
```

is straightforward.

---

# 16. Candidate MLP Architecture

Recommended V1:

```text
input
  |
Linear(input_dim, 64)
  |
ReLU
  |
Linear(64, 32)
  |
ReLU
  |
Linear(32, 1)
  |
logit
```

Keep it small.

---

# 17. No Huge Network

Do NOT use:

```text
512 -> 512 -> 512 -> ...
```

for a small tabular dataset.

The model should remain:

```text
small
CPU-friendly
ONNX-friendly
```

---

# 18. Dropout

Recommended V1:

```text
no dropout
```

This keeps:

```text
training
export
runtime parity
```

simple.

Regularization can come from:

```text
weight decay
early stopping
```

---

# 19. Activation

Freeze:

```text
ReLU
```

for V1.

Do not dynamically switch activation from config without changing model
semantics/version.

---

# 20. Output

Model produces:

```text
one raw logit
```

Do NOT put:

```text
Sigmoid
```

inside the training model if using:

```text
BCEWithLogitsLoss
```

Probability:

```text
sigmoid(logit)
```

is derived for metrics/inference.

---

# 21. Candidate Model Version

Persist:

```text
candidate-tabular-mlp-v1
```

Any architecture-changing modification requires:

```text
candidate-tabular-mlp-v2
```

Examples:

```text
hidden-layer dimensions
activation
output semantics
```

---

# 22. Feature Input Contract

Use the exact ordered feature list from:

```text
candidate-ml-view-v1
```

Do NOT create a second independent feature list in:

```text
transit/train.py
```

---

# 23. Feature Order Is Frozen

Given:

```text
ml-dataset-view-v1
```

training uses exactly:

```text
feature_names[0]
feature_names[1]
...
feature_names[N-1]
```

in that order.

---

# 24. No Alphabetical Reordering

Forbidden:

```python
sorted(feature_names)
```

unless the contract itself defines sorted order.

Model runtime order is semantic.

---

# 25. Leakage Guard

Before training assert that features do NOT contain:

```text
training_label

tic_id

source_product_id

sample_id

sector

matched_toi_id

toi_disposition

label_snapshot_id

label_policy_version
```

or other fields not classified as:

```text
MODEL_INPUT
```

---

# 26. Supervised Population

Candidate supervised training rows:

```text
POSITIVE
NEGATIVE
```

only.

---

# 27. Unresolved Rows

Mandatory:

```text
UNRESOLVED
    ->
not used in training loss
```

Do not map to:

```text
NEGATIVE
```

---

# 28. Excluded Rows

```text
EXCLUDED
```

do not participate in supervised training.

---

# 29. Label Encoding

Freeze:

```text
NEGATIVE = 0
POSITIVE = 1
```

Persist this mapping in training metadata.

---

# 30. Split Manifest Is Authoritative

Training receives:

```text
split_id
```

and reconstructs memberships from its immutable group assignments.

Do NOT rerun random splitting.

---

# 31. Never Random-Split During Training

Forbidden inside `train.py`:

```python
train_test_split(...)
```

Phase 6.1 already froze membership.

---

# 32. Same TIC Leakage Protection

Before training assert again:

```text
TRAIN TIC
INTERSECT
VALIDATION TIC
=
empty
```

Defense in depth is worthwhile.

---

# 33. Split Compatibility

Verify split manifest references the same:

```text
gold_snapshot_id
gold_manifest_sha256
dataset_view_version
view_fingerprint
```

as current training input.

---

# 34. Wrong Gold Snapshot

If:

```text
split.gold_snapshot_id != requested_gold_snapshot_id
```

fail:

```text
SPLIT_GOLD_MISMATCH
```

---

# 35. Gold Manifest SHA Mismatch

If current Gold manifest SHA differs from the split manifest:

```text
fail
```

Do not train against a different dataset under the same command.

---

# 36. Dataset View Mismatch

If split expects:

```text
candidate-ml-view-v1
```

but trainer code requests another view:

```text
fail
```

---

# 37. Feature Order Mismatch

If:

```text
split feature_names
!=
current view feature_names
```

fail before training.

---

# 38. Train-Only Preprocessing

Mandatory rule:

```text
fit preprocessing
    using TRAIN only
```

Validation may only call:

```text
transform
```

---

# 39. Forbidden Preprocessing Leakage

Do NOT:

```text
Gold all rows
    |
    v
fit scaler/imputer
    |
    v
split
```

and do not:

```text
TRAIN + VALIDATION
    |
    v
fit preprocessing
```

---

# 40. Preprocessing Version

Introduce:

```text
candidate-preprocess-v1
```

This freezes:

```text
nullable numeric handling

boolean encoding

standardization

constant-feature policy

feature order
```

---

# 41. Numeric Nullable Inputs

For nullable numeric MODEL_INPUT fields:

```text
fit median on TRAIN only
```

Then:

```text
TRAIN null
VALIDATION null
```

both use:

```text
TRAIN median
```

---

# 42. Median Imputation

For feature `f`:

```text
median_f =
median(
    finite TRAIN values for f
)
```

Never use validation values.

---

# 43. All-Missing TRAIN Feature

If a selected feature has:

```text
100% missing in TRAIN
```

there is no train median.

Recommended V1:

```text
fail with ALL_MISSING_TRAIN_FEATURE
```

Do NOT invent zero silently.

---

# 44. Validation-Only Values

If:

```text
TRAIN feature all missing
VALIDATION feature populated
```

still fail.

Validation must not determine preprocessing parameters.

---

# 45. Boolean Inputs

If a MODEL_INPUT boolean is non-null:

```text
false -> 0.0
true  -> 1.0
```

---

# 46. Nullable Boolean

Preferred V1:

```text
do not include nullable booleans
```

unless the preprocessing contract explicitly defines them.

Use existing availability flags that are non-null when possible.

---

# 47. Categorical Features

Recommended V1 candidate view:

```text
numeric + boolean features only
```

Avoid categorical one-hot encoding until there is a concrete scientific need.

---

# 48. Standardization

After TRAIN median imputation compute:

```text
mean_f
std_f
```

on TRAIN only.

Transform:

```text
z = (x - mean_f) / std_f
```

---

# 49. Constant Feature

If:

```text
std_f == 0
```

use deterministic denominator:

```text
scale_f = 1.0
```

so transformed values become:

```text
0
```

for that constant TRAIN value.

Record diagnostic warning.

---

# 50. Near-Zero Scale

Use an explicit small numerical tolerance only if required.

Do not have environment-dependent divide-by-nearly-zero behavior.

---

# 51. Preprocessing Artifact

Persist:

```text
preprocessing.json
```

containing:

```text
schema_version

preprocessing_version

feature_names

label_encoding

numeric_imputation

means

scales

boolean_encoding

created_from_train_rows

split_id
```

---

# 52. Preprocessing Values Are Model Artifacts

Do NOT write learned preprocessing values back into:

```text
Gold
```

Gold remains unchanged.

---

# 53. No Missing Indicator V1

Recommended V1:

```text
no automatic <feature>__missing columns
```

Keep runtime vector small.

If later added:

```text
candidate-preprocess-v2
```

---

# 54. Train/Validation Tensor Construction

Correct:

```text
Gold rows
   |
   v
split membership
   |
   +--> TRAIN -> fit + transform -> tensor
   |
   +--> VALIDATION -> transform only -> tensor
```

---

# 55. Tensor Type

Use:

```text
float32
```

for model input tensors.

Scientific Gold computation may be float64, but neural-network inference uses
an explicit float32 vector.

---

# 56. Label Tensor

Use:

```text
float32 0/1
```

compatible with:

```text
BCEWithLogitsLoss
```

---

# 57. Input Dimension

Validate:

```text
input_dim == len(feature_names)
```

for:

```text
model
preprocessing
TRAIN tensor
VALIDATION tensor
```

---

# 58. No Giant Tensor Requirement

Candidate Gold is scalar/tabular.

Whole TRAIN dataset may fit in RAM for project scale.

However code should not depend on millions of rows fitting into one GPU tensor.

---

# 59. DataLoader

Use a simple PyTorch:

```text
TensorDataset
+
DataLoader
```

or equivalent.

---

# 60. Batch Size

Recommended V1 default:

```text
64
```

Treat batch size as training configuration.

---

# 61. Shuffle

TRAIN DataLoader:

```text
shuffle=true
```

with deterministic seeded generator.

VALIDATION:

```text
shuffle=false
```

---

# 62. Training Seed

Require explicit:

```text
training_seed
```

Recommended development default:

```text
42
```

but persist actual value.

---

# 63. Split Seed != Training Seed

Maintain distinction:

```text
split_seed
    controls dataset membership

training_seed
    controls model optimization randomness
```

---

# 64. Random Seeds

Set training seed for:

```text
Python random

NumPy

PyTorch
```

where used.

---

# 65. CPU Determinism

Required CI/reference mode:

```text
device=cpu
```

Training should be reproducible within the pinned environment.

---

# 66. GPU Optional

Optional:

```text
device=cuda
```

may be supported.

But:

```text
CPU correctness is mandatory.
```

---

# 67. 4 GB VRAM Constraint

The tabular MLP must comfortably fit in:

```text
4 GB VRAM
```

No GPU memory optimization framework is necessary.

---

# 68. Device Is Recorded

Training run manifest records:

```text
requested_device

actual_device
```

Example:

```text
cpu
cuda
```

---

# 69. CPU Fallback

If:

```text
device=auto
```

and CUDA unavailable:

```text
use CPU
```

Do not fail training merely because GPU is missing.

---

# 70. Explicit CUDA Request

If user/config explicitly requests:

```text
device=cuda
```

but CUDA is unavailable:

```text
fail clearly
```

Do not silently ignore an explicit requirement.

---

# 71. Loss Function

Use:

```text
BCEWithLogitsLoss
```

---

# 72. Class Imbalance

Do not oversample/undersample in V1.

Use optional loss weighting.

Recommended policy:

```text
balanced-bce-v1
```

---

# 73. Positive Weight

For TRAIN only:

```text
pos_weight =
n_negative_train
/
n_positive_train
```

Require both classes to exist.

---

# 74. No Validation-Based Class Weight

Never include validation counts when computing:

```text
pos_weight
```

---

# 75. Persist Class Weight

Training run metadata records:

```text
class_weight_policy
pos_weight
train_positive_count
train_negative_count
```

---

# 76. No SMOTE

Do not add:

```text
SMOTE
synthetic minority sampling
```

to V1.

---

# 77. Optimizer

Recommended:

```text
AdamW
```

---

# 78. Default Learning Rate

Recommended:

```text
1e-3
```

Persist in training config.

---

# 79. Weight Decay

Recommended:

```text
1e-4
```

Persist it.

---

# 80. Maximum Epochs

Recommended:

```text
100
```

This is a safety ceiling, not a required number of epochs.

---

# 81. Early Stopping

Implement:

```text
early stopping
```

using:

```text
VALIDATION loss
```

not golden test.

---

# 82. Early-Stopping Patience

Recommended:

```text
10 epochs
```

Persist actual setting.

---

# 83. Minimum Improvement

Use explicit:

```text
min_delta
```

Example:

```text
1e-5
```

to avoid floating noise resetting patience forever.

---

# 84. Best Epoch

Track:

```text
best_validation_loss

best_epoch
```

---

# 85. Final Native Model

Durable training artifact should contain:

```text
best validation-loss state_dict
```

not automatically the final last epoch.

---

# 86. No Golden Test For Early Stopping

Mandatory:

```text
golden-test rows
    ->
never loaded in Phase 6.2
```

---

# 87. No Recent Holdout

Same:

```text
recent holdout
```

belongs to Phase 6.4.

---

# 88. Development Validation Metrics

Phase 6.2 may report:

```text
validation_loss

PR-AUC

ROC-AUC
```

and diagnostic:

```text
precision@0.5

recall@0.5

F1@0.5

confusion matrix @ 0.5
```

---

# 89. Primary Development Metric

Prefer:

```text
PR-AUC
```

for imbalanced candidate data.

Do not present accuracy as the primary success metric.

---

# 90. Threshold 0.5 Is Diagnostic Only

Phase 6.2 must NOT freeze:

```text
production decision threshold = 0.5
```

A threshold is selected/evaluated later in Phase 6.4.

---

# 91. Do Not Optimize Threshold Here

No validation threshold search is required in Phase 6.2.

Keep outputs:

```text
probabilities
continuous ranking metrics
```

---

# 92. ROC-AUC Edge Case

If VALIDATION accidentally has one class only, Phase 6.1 should already have
blocked the split.

Training should still assert class coverage.

---

# 93. PR-AUC Definition

Use one explicit implementation from:

```text
scikit-learn
```

or the existing metric library.

Document exact metric semantics.

---

# 94. Dependency Discipline

If using scikit-learn for metrics:

```text
declare it in pyproject.toml
```

Do not rely on undeclared environment packages.

---

# 95. Training Configuration

Create one explicit configuration object containing:

```text
model_version

preprocessing_version

training_seed

batch_size

learning_rate

weight_decay

max_epochs

early_stopping_patience

early_stopping_min_delta

class_weight_policy

device
```

---

# 96. Scientific/Model Config vs Operational Config

Training fingerprint should include model-affecting settings.

Do NOT include:

```text
log level

MinIO host

temporary directory
```

---

# 97. Training Spec Fingerprint

Compute deterministic:

```text
training_spec_fingerprint =
SHA256(
    gold_snapshot_id
    +
    split_id
    +
    dataset_view_fingerprint
    +
    model_version
    +
    preprocessing_version
    +
    training_seed
    +
    canonical hyperparameters
)
```

---

# 98. Training Spec Fingerprint Is Not Run ID

Freeze distinction:

```text
training_spec_fingerprint
    =
what we intended to train

training_run_id
    =
one concrete execution attempt
```

---

# 99. Training Run ID

Use a unique stable identifier for one execution.

Example format:

```text
candidate-run-<timestamp>-<short-random>
```

or equivalent.

It need not be scientific/deterministic.

---

# 100. Why Run ID Is Not Deterministic

Two executions of the same training specification may legitimately exist:

```text
same Gold
same split
same config
same seed
```

but they are still distinct recorded runs.

Their:

```text
training_spec_fingerprint
```

is the same.

---

# 101. Training Run Storage

Introduce:

```text
training-runs/
└── candidate/
    └── <training-run-id>/
        ├── manifest.json
        ├── model.pt
        ├── preprocessing.json
        └── metrics.json
```

Optional:

```text
history.json
```

only if useful.

---

# 102. Do Not Put Run Artifacts Under Gold

Wrong:

```text
gold/snapshots/.../model.pt
```

Gold remains immutable scientific data.

---

# 103. Do Not Register Champion Yet

Phase 6.2 does NOT write:

```text
models/candidate/champion.json
```

Registry/promotion is Phase 6.5.

---

# 104. Training Run != Registry Model

Freeze:

```text
training-runs/
    experimental execution artifacts

models/
    immutable registry model packages
```

Phase 6.5 will promote/package eligible training outputs.

---

# 105. Native Model Artifact

Save:

```text
state_dict
```

plus architecture version/config.

Do not rely on serializing an arbitrary live Python class object as the only
model representation.

---

# 106. Native Model Filename

Use:

```text
model.pt
```

or one explicit equivalent.

---

# 107. Native Model SHA256

Compute:

```text
model_sha256
```

for the durable native model file.

---

# 108. Preprocessing SHA256

Compute:

```text
preprocessing_sha256
```

---

# 109. Metrics SHA256

Optional but recommended:

```text
metrics_sha256
```

for artifact integrity.

---

# 110. Training Run Manifest

Create:

```text
contracts/data/training-run-v1.md
```

for the immutable training-run manifest.

---

# 111. Training Run Manifest Fields

Required conceptual fields:

```text
schema_version

training_run_id

training_spec_fingerprint

task

model_version

gold_snapshot_id

gold_manifest_sha256

split_id

split_manifest_sha256

dataset_view_version

dataset_view_fingerprint

feature_names

label_encoding

preprocessing_version

training_seed

hyperparameters

class_weight_policy

train_row_count

validation_row_count

train_class_counts

validation_class_counts

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

# 112. Task

Use explicit:

```text
candidate_vetting
```

Do not call it:

```text
planet_confirmation
```

---

# 113. Model Semantics

Document:

```text
candidate-tabular-mlp-v1
```

as:

```text
catalog-supervised candidate vetting classifier
```

not a scientific confirmation instrument.

---

# 114. Runtime Versions

Record useful reproducibility information:

```text
Python version

PyTorch version

NumPy version

scikit-learn version if used
```

Optional:

```text
CUDA runtime
```

when applicable.

---

# 115. Git Revision

If repository Git revision is available, record:

```text
git_commit
```

as audit metadata.

Do not fail training solely because `.git` metadata is unavailable in a
packaged environment.

---

# 116. Training History

If stored, keep compact:

```text
epoch

train_loss

validation_loss
```

Optional:

```text
validation_pr_auc
```

Do not store every batch loss.

---

# 117. Training Run Manifest Written Last

Required order:

```text
train
  |
  v
best native model
  |
  v
preprocessing artifact
  |
  v
metrics artifact
  |
  v
verify artifacts
  |
  v
manifest.json
```

The immutable manifest commits the training run.

---

# 118. Partial Training Run

If:

```text
model.pt exists
manifest missing
```

the training run is:

```text
NOT COMMITTED
```

---

# 119. Training Run Immutability

After:

```text
manifest.json
```

exists:

```text
do not modify
model.pt

preprocessing.json

metrics.json

manifest.json
```

---

# 120. Rerun Means New Run

A new independent training execution should normally create:

```text
new training_run_id
```

even when:

```text
training_spec_fingerprint
```

is identical.

---

# 121. Training Checkpoint Begins Here

Introduce:

```text
checkpoints/ml-training/
```

Now it is justified.

---

# 122. Checkpoint Layout

Recommended:

```text
checkpoints/
└── ml-training/
    └── candidate/
        └── <training-run-id>.json
```

---

# 123. Checkpoint Ownership

Owned by:

```text
Python candidate trainer
```

Go/Rust do not write this checkpoint.

---

# 124. Checkpoint Purpose

Freeze:

```text
training checkpoint
    =
run-level recovery state
```

Not:

```text
model registry
dataset truth
distributed lock
```

---

# 125. V1 Does Not Require Mid-Epoch Resume

Important simplification:

```text
Phase 6.2 checkpoint
    does NOT promise optimizer-state / gradient resume
```

If training crashes mid-training:

```text
restart training deterministically from epoch 0
```

using the same:

```text
Gold
split
config
training seed
```

---

# 126. Why No Optimizer Resume

For the small V1 tabular model:

```text
retraining is cheap
```

Avoid adding:

```text
optimizer checkpoint files
epoch-by-epoch snapshots
distributed resume logic
```

prematurely.

---

# 127. Training Checkpoint States

Use:

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

# 128. PLANNED

Means:

```text
Gold/split/config validated
training not yet completed
```

---

# 129. TRAINING

Means:

```text
training execution started
```

It does not mean model weights are durable.

---

# 130. ARTIFACT_STORED

Means:

```text
model.pt
preprocessing.json
metrics.json
```

exist and verify.

Training run manifest may not yet be committed.

---

# 131. COMPLETED

Means:

```text
immutable training-run manifest exists
+
all referenced artifacts verify
```

---

# 132. FAILED

Means:

```text
latest attempt failed
```

A failed checkpoint does not make a partial run canonical.

---

# 133. Checkpoint Fields

Conceptual:

```text
schema_version

training_run_id

training_spec_fingerprint

state

attempts

gold_snapshot_id

split_id

last_error

model_key

preprocessing_key

metrics_key

created_at

updated_at
```

---

# 134. Checkpoint Is Not Proof

If:

```text
checkpoint=COMPLETED
```

but:

```text
training run manifest missing
```

checkpoint is stale.

Artifact truth wins.

---

# 135. Valid Manifest + Missing Checkpoint

If committed training-run manifest is valid:

```text
reconstruct COMPLETED checkpoint
```

Do not retrain.

---

# 136. ARTIFACT_STORED + Missing Manifest

If model/preprocessing/metrics all verify:

```text
write deterministic run manifest
```

then:

```text
COMPLETED
```

No retraining.

---

# 137. TRAINING + No Final Artifacts

On restart:

```text
rerun training from epoch 0
```

with same exact run specification and seed.

---

# 138. TRAINING + Partial Artifacts

If only some final artifacts exist:

```text
do not trust them independently
```

Recommended V1:

```text
restart training
```

and replace only uncommitted same-run temporary/final artifacts after
explicit validation.

---

# 139. Pre-Commit Artifact Rewrite

Before run manifest commit, the same training run may rewrite its own
incomplete artifacts during recovery.

After manifest commit:

```text
immutable
```

---

# 140. Completed Artifact Conflict

If committed manifest says:

```text
model_sha256=A
```

but object is:

```text
B
```

return:

```text
TRAINING_ARTIFACT_INTEGRITY_ERROR
```

Do not silently retrain under the same committed run ID.

---

# 141. Checkpoint Write Before Training

Required:

```text
write PLANNED
```

before expensive training begins.

---

# 142. Checkpoint Failure Before Training

If checkpoint cannot be persisted:

```text
fail
```

Do not start an uncontrolled run.

---

# 143. Transition To TRAINING

After all input/config validation succeeds:

```text
checkpoint -> TRAINING
```

then begin optimization.

---

# 144. Artifact Commit Ordering

After model selection:

```text
write model.pt
verify

write preprocessing.json
verify

write metrics.json
verify

checkpoint ARTIFACT_STORED

write manifest.json
verify

checkpoint COMPLETED
```

---

# 145. Checkpoint Failure After Manifest

If training-run manifest is already committed but:

```text
COMPLETED checkpoint write fails
```

run is still valid.

Restart:

```text
manifest -> repair checkpoint
```

---

# 146. Validation Metrics Artifact

`metrics.json` should contain development metrics only.

Recommended:

```text
train_loss_best_epoch

validation_loss

validation_pr_auc

validation_roc_auc

validation_precision_at_0_5

validation_recall_at_0_5

validation_f1_at_0_5

validation_confusion_matrix_at_0_5
```

---

# 147. Metrics Must Be Clearly Labeled

Do not store:

```text
pr_auc
```

without context.

Use:

```text
validation_pr_auc
```

because Phase 6.4 later adds final evaluation metrics.

---

# 148. No Test Metrics

Phase 6.2 `metrics.json` must NOT contain:

```text
golden_test_*

recent_holdout_*
```

---

# 149. No Promotion Decision

Do not write:

```text
promotion_pass=true
```

in Phase 6.2.

Promotion is Phase 6.5 after Phase 6.4 evaluation.

---

# 150. Training Configuration CLI

Add one clear command:

```bash
python -m aurora_ml.main train-candidate \
    --snapshot-id <gold-snapshot-id> \
    --split-id <split-id> \
    --training-seed 42
```

---

# 151. Optional Device CLI

Support:

```text
--device cpu

--device auto

--device cuda
```

Recommended default:

```text
cpu
```

for V1 reproducibility.

---

# 152. Optional Hyperparameters

Avoid exposing every architecture detail.

Useful explicit options may include:

```text
--learning-rate
--batch-size
--max-epochs
--patience
```

Model architecture remains tied to:

```text
candidate-tabular-mlp-v1
```

---

# 153. CLI Output

Example:

```text
training_run_id:        candidate-run-...
training_spec:          ...
gold_snapshot_id:       ...
split_id:               ...

model:                  candidate-tabular-mlp-v1
preprocessing:          candidate-preprocess-v1
features:               18

TRAIN:
  rows:                 ...
  positive:             ...
  negative:             ...

VALIDATION:
  rows:                 ...
  positive:             ...
  negative:             ...

best_epoch:             ...
validation_loss:        ...
validation_pr_auc:      ...
validation_roc_auc:     ...

state:                  COMPLETED
```

---

# 154. No Planet Verdict In CLI

Do not output:

```text
planet confirmed
```

Training metrics describe classifier behavior only.

---

# 155. Feature Null Summary Before Training

Log/report:

```text
missing fraction per model input
```

for:

```text
TRAIN

VALIDATION
```

before preprocessing.

---

# 156. Train Median Testability

Preprocessing fit should be a pure/testable function such as:

```python
fit_candidate_preprocessing(train_rows, feature_names)
```

---

# 157. Transform Function

Preferred:

```python
transform_candidate_rows(rows, preprocessing)
```

The transform function must NOT refit anything.

---

# 158. Model Construction Function

Preferred:

```python
build_candidate_model(input_dim)
```

or equivalent using:

```text
candidate-tabular-mlp-v1
```

---

# 159. Training Loop Function

Keep independently testable:

```python
train_candidate_model(...)
```

Do not mix MinIO I/O into every optimization step.

---

# 160. Orchestration Boundary

Higher-level function may:

```text
load Gold
load split
validate
fit preprocessing
train
evaluate validation
write artifacts
update checkpoint
```

Scientific/data math remains testable separately.

---

# 161. No Generic Repository Layer

Do not create a database-style repository abstraction for four MinIO objects.

Use existing storage primitives.

---

# 162. No Global `utils.py`

Keep:

```text
seed setup
preprocessing
candidate training
```

under their responsible module.

---

# 163. Numerical Stability

Before tensor conversion verify transformed values are finite.

After preprocessing:

```text
NaN = 0 expected
Inf = 0 expected
```

for candidate model inputs.

---

# 164. Preprocessing Integrity

Assert:

```text
len(medians)
==
len(means)
==
len(scales)
==
len(feature_names)
```

---

# 165. Model Input Integrity

Every batch must have shape:

```text
[N, input_dim]
```

---

# 166. Output Integrity

Model output expected:

```text
[N]
```

or:

```text
[N, 1]
```

Choose one and freeze the convention.

Recommended:

```text
[N]
```

after squeezing only the last singleton dimension.

---

# 167. Probability Range

For metrics:

```text
probability = sigmoid(logit)
```

Verify:

```text
0 <= probability <= 1
```

---

# 168. No Prediction Persistence Yet

Do NOT store validation predictions under:

```text
predictions/
```

in Phase 6.2.

Metrics can be calculated in memory.

---

# 169. Optional Validation Prediction Debugging

If tests need predictions, use:

```text
temporary/local test output
```

not durable production prediction artifacts.

---

# 170. No Threshold Artifact Yet

Do not persist a production:

```text
decision_threshold
```

in preprocessing or training-run manifest.

Phase 6.4 owns threshold evaluation/freeze.

---

# 171. Reproducibility Scope

CPU test environment should verify:

```text
same Gold
same split
same training configuration
same training seed
same package versions
```

produces reproducible:

```text
preprocessing parameters

training history / best epoch

validation metrics

native model logical behavior
```

---

# 172. Bitwise Weight Equality

If PyTorch version/environment guarantees identical CPU result, exact
state-dict hashes may match.

Do not make the entire architecture depend on cross-device bitwise equality.

---

# 173. GPU Numeric Variation

GPU runs may differ slightly.

Record:

```text
device

runtime versions

model SHA
```

and evaluate within numerical tolerance.

---

# 174. Training Spec vs Result

Same:

```text
training_spec_fingerprint
```

may theoretically produce different native model bytes on different
hardware/runtime implementations.

That is why:

```text
run ID
model SHA
runtime metadata
```

are all preserved.

---

# 175. Unit Test — MLP Shape

Input:

```text
batch=4
features=10
```

Expected:

```text
output shape = [4]
```

---

# 176. Unit Test — MLP Finite Output

Random deterministic finite tensor:

```text
output logits finite
```

---

# 177. Unit Test — Feature Order

Build known row.

Verify tensor value positions exactly match:

```text
candidate-ml-view-v1 feature order
```

---

# 178. Unit Test — Label Encoding

Verify:

```text
NEGATIVE -> 0.0
POSITIVE -> 1.0
```

No unresolved encoding.

---

# 179. Unit Test — UNRESOLVED Exclusion

Mandatory.

---

# 180. Unit Test — EXCLUDED Exclusion

Mandatory.

---

# 181. Unit Test — Train Median

TRAIN:

```text
feature = [1, null, 3]
```

Expected median:

```text
2
```

---

# 182. Unit Test — Validation Does Not Influence Median

TRAIN:

```text
[1, 3]
```

VALIDATION:

```text
[100000]
```

Expected TRAIN median:

```text
2
```

---

# 183. Unit Test — All Missing TRAIN

Expected:

```text
ALL_MISSING_TRAIN_FEATURE
```

---

# 184. Unit Test — Standardization

Known TRAIN values.

Verify:

```text
mean
scale
transformed values
```

---

# 185. Unit Test — Validation Does Not Influence Mean/Std

Use extreme validation values.

Expected preprocessing parameters unchanged.

---

# 186. Unit Test — Constant Feature

TRAIN:

```text
[5, 5, 5]
```

Expected:

```text
mean = 5
scale = 1
transformed = 0
```

---

# 187. Unit Test — Boolean Encoding

Verify:

```text
false -> 0
true -> 1
```

---

# 188. Unit Test — Preprocessing Finite Output

After imputation/scaling:

```text
no NaN
no Inf
```

---

# 189. Unit Test — Preprocessing Serialization

Round-trip:

```text
feature order

median

mean

scale

boolean policy

label encoding
```

must remain exact.

---

# 190. Unit Test — Preprocessing Version

Artifact contains:

```text
candidate-preprocess-v1
```

---

# 191. Unit Test — Train-Only Class Weight

TRAIN:

```text
negative=90
positive=10
```

Expected:

```text
pos_weight=9
```

Validation class count must not affect it.

---

# 192. Unit Test — Class Weight Invalid

If TRAIN lacks one class:

```text
fail
```

Phase 6.1 should prevent this, but trainer checks again.

---

# 193. Unit Test — Deterministic DataLoader

Same:

```text
training_seed
```

produces same TRAIN batch ordering in CPU tests.

---

# 194. Unit Test — Training Seed Change

Changing:

```text
training_seed
```

must change:

```text
training_spec_fingerprint
```

---

# 195. Unit Test — Split Seed Does Not Become Training Seed

Trainer uses split membership as stored.

It does not reinterpret:

```text
split_seed
```

as PyTorch initialization seed.

---

# 196. Unit Test — Training Spec Stability

Same canonical config:

```text
same training_spec_fingerprint
```

---

# 197. Unit Test — Hyperparameter Change

Change:

```text
learning_rate
```

Expected:

```text
training_spec_fingerprint changes
```

---

# 198. Unit Test — Model Version Change

Expected fingerprint change.

---

# 199. Unit Test — Preprocessing Version Change

Expected fingerprint change.

---

# 200. Unit Test — Log Level Independence

Changing:

```text
log level
```

must NOT change training-spec fingerprint.

---

# 201. Unit Test — MinIO Endpoint Independence

Operational hostname must not change training-spec fingerprint.

---

# 202. Unit Test — Loss Decreases

Use a tiny linearly separable synthetic training fixture.

Expected training:

```text
loss improves
```

without requiring unrealistic perfect performance.

---

# 203. Unit Test — Early Stopping

Synthetic/controlled history should stop after:

```text
patience
```

without improvement.

---

# 204. Unit Test — Best Epoch Restore

Ensure final:

```text
model.pt
```

contains the best validation-loss state, not necessarily final epoch.

---

# 205. Unit Test — Metric Computation

Known labels/probabilities.

Verify:

```text
PR-AUC

ROC-AUC

precision

recall

F1

confusion matrix
```

---

# 206. Unit Test — Threshold Is Diagnostic

Verify validation metric code may calculate at:

```text
0.5
```

but training artifact does not mark it as a production threshold.

---

# 207. Unit Test — No Golden Test Read

Training loader should recognize only:

```text
TRAIN
VALIDATION
```

from Phase 6.1 development split.

---

# 208. Unit Test — Split Gold Mismatch

Wrong Gold snapshot:

```text
SPLIT_GOLD_MISMATCH
```

---

# 209. Unit Test — Gold Manifest SHA Mismatch

Expected failure.

---

# 210. Unit Test — View Fingerprint Mismatch

Expected failure.

---

# 211. Unit Test — Feature Order Mismatch

Expected failure before preprocessing/model creation.

---

# 212. Unit Test — Same TIC Disjointness

Trainer preflight revalidates:

```text
TRAIN TIC ∩ VALIDATION TIC = empty
```

---

# 213. Unit Test — Training Run Manifest

Round-trip all important fields.

---

# 214. Unit Test — Training Run Manifest Version

Unknown schema version must fail clearly.

---

# 215. Unit Test — Model SHA

Verify stored:

```text
model_sha256
```

matches bytes.

---

# 216. Unit Test — Preprocessing SHA

Same.

---

# 217. Unit Test — Artifact Verification

Corrupt:

```text
model.pt
```

Expected integrity failure.

---

# 218. Unit Test — Checkpoint Serialization

Round-trip:

```text
PLANNED
TRAINING
ARTIFACT_STORED
COMPLETED
FAILED
```

---

# 219. Unit Test — Checkpoint Unknown Version

Expected clear failure.

---

# 220. Unit Test — COMPLETED Is Not Proof

Checkpoint says:

```text
COMPLETED
```

manifest absent:

```text
do not accept completed run
```

---

# 221. Unit Test — Manifest Repairs Checkpoint

Valid immutable run manifest + missing checkpoint:

```text
repair -> COMPLETED
```

---

# 222. Unit Test — ARTIFACT_STORED Recovery

Valid:

```text
model
preprocessing
metrics
```

manifest absent.

Expected:

```text
commit manifest
COMPLETED
```

without retraining.

---

# 223. Unit Test — TRAINING Recovery

No final valid artifact:

```text
restart training from epoch 0
```

---

# 224. Integration — Stage 6.1 Split

Use:

```text
committed candidate Gold
+
immutable ml-split-v1
```

Train one tiny candidate model.

Expected:

```text
COMPLETED training run
```

---

# 225. Integration — Gold-Only Reads

Instrument storage.

During complete candidate training:

```text
Bronze reads = 0
Silver reads = 0
```

Mandatory.

---

# 226. Integration — ClickHouse Offline

Stop ClickHouse.

Candidate training must succeed.

---

# 227. Integration — NATS Offline

Stop NATS.

Candidate training must succeed.

---

# 228. Integration — No External Network

Disable internet.

Training must succeed.

---

# 229. Integration — CPU Only

Hide CUDA.

Training succeeds.

---

# 230. Integration — Optional CUDA

If CUDA exists locally:

```text
small manual test
```

may verify candidate model fits within available VRAM.

Do not require CUDA in CI.

---

# 231. Integration — RAW_DELETED Provenance

Use Gold derived from:

```text
Bronze RAW_DELETED
```

Training must be identical in architecture to any other Gold snapshot.

No raw recovery.

---

# 232. Integration — Validation Leakage Test

Change only VALIDATION values drastically.

Expected:

```text
TRAIN preprocessing parameters unchanged
```

Model optimization may change because validation/early stopping changes, which
is expected.

---

# 233. Integration — Unresolved Rows

Add many:

```text
UNRESOLVED
```

Gold rows.

Expected:

```text
TRAIN row count unchanged
VALIDATION supervised row count unchanged
```

for the same Phase 6.1 split inputs.

---

# 234. Integration — Natural Class Distribution

Verify no duplicate source IDs are introduced by candidate training.

---

# 235. Integration — Same Training Specification

Run two independent CPU training runs with:

```text
same Gold
same split
same training seed
same runtime
```

Expected:

```text
same training_spec_fingerprint
```

and reproducible metrics within frozen tolerance.

---

# 236. Integration — Different Training Seed

Expected:

```text
same split
different training_spec_fingerprint
different training run
```

No dataset membership change.

---

# 237. Integration — Different Split

Expected:

```text
new split_id
new training_spec_fingerprint
```

---

# 238. Integration — Different Gold Snapshot

Expected:

```text
new training specification
```

No accidental use of old split.

---

# 239. Crash Test — Before Training

Crash after:

```text
PLANNED
```

Restart.

Expected:

```text
start training normally
```

---

# 240. Crash Test — During Training

Kill process while state:

```text
TRAINING
```

Restart same run.

Expected:

```text
retrain from epoch 0
```

No optimizer-state resume required.

---

# 241. Crash Test — Model Written Before Preprocessing

Run remains uncommitted.

Restart safely retrains/rebuilds final artifact set.

---

# 242. Crash Test — All Artifacts Before ARTIFACT_STORED

Restart:

```text
verify artifact set
```

If exact and valid, recovery may progress without retraining.

---

# 243. Crash Test — ARTIFACT_STORED Before Manifest

Mandatory.

Restart:

```text
verify artifacts

write manifest

COMPLETED
```

---

# 244. Crash Test — Manifest Before COMPLETED

Mandatory.

Restart:

```text
verify manifest/artifacts

repair checkpoint
```

No retraining.

---

# 245. MinIO Failure During Model Upload

Expected:

```text
no committed training run
checkpoint FAILED
```

Gold/split unchanged.

---

# 246. MinIO Failure During Manifest PUT

Artifacts may exist.

Run remains:

```text
uncommitted
```

Recovery must be possible.

---

# 247. Model Artifact Corruption

After committed run, corrupt model.

Expected:

```text
integrity failure
```

Do not silently regenerate under same committed run ID.

---

# 248. Preprocessing Artifact Corruption

Same rule.

---

# 249. Training Run Manifest Corruption

Checksum/parse failure means the run is not trusted.

Do not substitute checkpoint state as truth.

---

# 250. No Gold Mutation Test

Record Gold artifact hashes before training.

After training:

```text
all unchanged
```

---

# 251. No Split Mutation Test

Record split manifest SHA before training.

After:

```text
unchanged
```

---

# 252. Training Output Scope

Phase 6.2 may write only:

```text
checkpoints/ml-training/

training-runs/candidate/
```

plus logs/temp files.

Do NOT write:

```text
Gold

Silver

catalogs

labels

lineage

lifecycle checkpoints
```

---

# 253. No Registry Model Yet

Do not create final:

```text
models/candidate/<model-id>/
```

in Phase 6.2.

Phase 6.5 owns model registry packaging/promotion.

---

# 254. No Champion Pointer

No:

```text
models/candidate/champion.json
```

---

# 255. No Challenger Pointer

No mutable:

```text
challenger.json
```

required.

Training runs themselves are candidate experiments.

---

# 256. No Promotion Metrics

Do not decide:

```text
this model is better than champion
```

yet.

---

# 257. No Final Evaluation

Validation metrics are development metrics only.

Phase 6.4 owns:

```text
golden test
recent holdout
threshold selection
```

---

# 258. No ONNX

Do not call:

```text
export_onnx.py
```

yet.

---

# 259. No Rust Inference

Do not modify:

```text
apps/rust-inference/
```

in Phase 6.2.

---

# 260. No Predictions Prefix

Do not create:

```text
predictions/
```

yet.

---

# 261. No Prediction NATS Events

No:

```text
aurora.v1.prediction.ready
```

---

# 262. No API Changes

Go API should not serve this training run yet.

---

# 263. No Dashboard Changes

No model metrics UI yet.

---

# 264. Training Run Contract

Add:

```text
contracts/data/training-run-v1.md
```

Document:

```text
immutable run identity

Gold/split provenance

training specification

artifact references

development validation metrics

commit semantics
```

---

# 265. Do Not Add Model Manifest Contract Yet

Reserve:

```text
model-manifest-v1.md
```

for Phase 6.5 when registry models actually exist.

---

# 266. Do Not Add Model Runtime Contract Yet

Reserve:

```text
model-runtime-v1.md
```

for Phase 6.6.

---

# 267. Training Documentation

Add:

```text
docs/ML_TRAINING.md
```

---

# 268. ML_TRAINING.md Contents

Document:

```text
Gold-only input boundary

split-manifest requirement

candidate-tabular-mlp-v1

candidate-preprocess-v1

train-only imputation/scaling

class weighting

training seed

validation-only early stopping

training run artifacts

training checkpoint recovery

no golden-test usage
```

---

# 269. Update ML_DATASETS.md

Add cross-reference:

```text
Phase 6.1 freezes membership.
Phase 6.2 never re-splits.
```

---

# 270. Update CHECKPOINTS.md

Checkpoint hierarchy now becomes:

```text
checkpoints/
├── ingestion/
├── preprocessing/
├── feature-engineering/
├── ml-training/
└── lifecycle/
```

Do NOT add:

```text
inference/
```

until inference checkpoints are actually implemented.

---

# 271. CHECKPOINTS.md ML Section

Document:

```text
owner:
    Python candidate/anomaly training

purpose:
    run-level recovery

not:
    model registry
    gradient checkpoint database
```

---

# 272. Update CONFIGURATION.md

Add only implemented candidate training settings.

Examples:

```text
default training device

default batch size

default learning rate

default max epochs

default patience
```

Experiment identity values such as:

```text
training seed
```

are preferably explicit CLI/config-file inputs rather than hidden environment
state.

---

# 273. Python README

Update:

```text
Gold
  |
  v
group-safe split
  |
  v
TRAIN-only preprocessing
  |
  v
candidate-tabular-mlp-v1
  |
  v
immutable training run
```

---

# 274. STRUCTURE.md

Reflect actual additions such as:

```text
aurora_ml/training_checkpoint.py

contracts/data/training-run-v1.md

docs/ML_TRAINING.md
```

Do not document future Phase 6.5/6.6 files that do not exist.

---

# 275. Expected Python Tree

Likely:

```text
aurora_ml/
├── analytics.py
├── catalogs.py
├── checkpoint.py
├── config.py
├── data.py
├── evaluate.py
├── evidence.py
├── export_onnx.py
├── feature_checkpoint.py
├── features.py
├── gold.py
├── gold_materialize.py
├── main.py
├── registry.py
├── splits.py
├── training_checkpoint.py
│
├── transit/
│   ├── model.py
│   └── train.py
│
└── anomaly/
    ├── model.py
    └── train.py
```

Do not restructure more unless actual code size requires it.

---

# 276. Test Placement

Recommended:

```text
tests/
├── test_candidate_training.py
└── test_training_checkpoint.py
```

Reuse:

```text
test_splits.py
```

for split semantics.

---

# 277. Test Fixture Size

Use tiny deterministic training fixtures.

Do not require thousands of real TESS rows in normal unit tests.

---

# 278. Synthetic Classification Fixture

Useful fixture:

```text
two or more numeric features
clear positive/negative separation
multiple TIC groups
```

Purpose:

```text
training loop correctness
```

not scientific benchmark claims.

---

# 279. Real Gold Integration Fixture

Also test against a tiny actual:

```text
gold-candidate-v1
```

produced by Stage 5.

This catches schema/role integration problems.

---

# 280. Training Runtime Sanity

Tiny CI training should finish quickly.

Do not run:

```text
100 epochs
```

when early-stop/unit config can validate logic in a few epochs.

Tests may override:

```text
max_epochs=5
```

without changing production defaults.

---

# 281. No Performance Benchmark Requirement

Formal model-quality claims require Phase 6.4.

Phase 6.2 proves:

```text
correct training lifecycle
reproducibility
leakage protection
durable artifacts
```

---

# 282. Core Invariants

Invariant 1:

```text
Candidate training consumes an explicit COMMITTED Gold snapshot.
```

Invariant 2:

```text
Candidate training consumes an explicit immutable split manifest.
```

Invariant 3:

```text
Phase 6.2 performs zero Bronze reads.
```

Invariant 4:

```text
Phase 6.2 performs zero Silver reads.
```

Invariant 5:

```text
ClickHouse is not required for training correctness.
```

Invariant 6:

```text
Live TIC/TOI/TCE state is never queried during training.
```

Invariant 7:

```text
Only POSITIVE and NEGATIVE rows enter supervised candidate loss.
```

Invariant 8:

```text
UNRESOLVED is never converted to NEGATIVE.
```

Invariant 9:

```text
Training never re-splits Gold rows.
```

Invariant 10:

```text
Same-TIC group separation is revalidated before training.
```

Invariant 11:

```text
Only explicit MODEL_INPUT columns enter the tensor.
```

Invariant 12:

```text
Feature order is exact and immutable for the model.
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
Validation rows never influence preprocessing parameters.
```

Invariant 16:

```text
Class weight is calculated from TRAIN only.
```

Invariant 17:

```text
No oversampling/undersampling modifies the canonical training population.
```

Invariant 18:

```text
candidate-tabular-mlp-v1 is small and CPU-correct.
```

Invariant 19:

```text
Golden test is not accessed in Phase 6.2.
```

Invariant 20:

```text
Development validation metrics are not final evaluation metrics.
```

Invariant 21:

```text
Training runs are immutable after manifest commit.
```

Invariant 22:

```text
Training checkpoints are recovery state, not registry truth.
```

Invariant 23:

```text
V1 training recovery is run-level; optimizer-state resume is not required.
```

Invariant 24:

```text
Phase 6.2 does not promote a model.
```

Invariant 25:

```text
Phase 6.2 does not export ONNX.
```

Invariant 26:

```text
AURORA model output is candidate-vetting evidence, not planet confirmation.
```

---

# Definition of Done

Phase 6.2 is COMPLETE when:

* [ ] Candidate training accepts explicit `gold_snapshot_id`.
* [ ] Candidate training accepts explicit `split_id`.
* [ ] Candidate training accepts explicit `training_seed`.
* [ ] Gold snapshot must be COMMITTED.
* [ ] Gold manifest integrity is validated.
* [ ] Split manifest integrity is validated.
* [ ] Split Gold snapshot ID must match requested Gold.
* [ ] Split Gold manifest SHA must match.
* [ ] Dataset-view version must match.
* [ ] Dataset-view fingerprint must match.
* [ ] Feature order must match.
* [ ] TRAIN/VALIDATION TIC disjointness is revalidated.
* [ ] No random row split occurs in training code.
* [ ] Candidate training reads zero Bronze objects.
* [ ] Candidate training reads zero Silver objects.
* [ ] Candidate training requires no ClickHouse.
* [ ] Candidate training requires no NATS.
* [ ] Candidate training requires no Go API.
* [ ] Candidate training requires no dashboard.
* [ ] Candidate training performs no live TIC query.
* [ ] Candidate training performs no live TOI query.
* [ ] Candidate training performs no live TCE query.
* [ ] Candidate model uses `candidate-ml-view-v1`.
* [ ] Only MODEL_INPUT fields are selected.
* [ ] `training_label` is excluded from model input.
* [ ] `tic_id` is excluded from model input.
* [ ] `source_product_id` is excluded from model input.
* [ ] `sample_id` is excluded from model input.
* [ ] `sector` is excluded from V1 model input.
* [ ] TOI audit fields are excluded from model input.
* [ ] Label snapshot/policy fields are excluded from model input.
* [ ] Exact feature order is preserved.
* [ ] `NEGATIVE=0` is frozen.
* [ ] `POSITIVE=1` is frozen.
* [ ] `UNRESOLVED` rows are excluded from supervised loss.
* [ ] `EXCLUDED` rows are excluded from supervised loss.
* [ ] `UNRESOLVED` is never interpreted as negative.
* [ ] `candidate-preprocess-v1` exists.
* [ ] Numeric nullable fields use TRAIN median imputation.
* [ ] Validation values do not influence medians.
* [ ] All-missing TRAIN feature fails clearly.
* [ ] Standardization uses TRAIN only.
* [ ] Validation values do not influence means/scales.
* [ ] Constant-feature scale policy is deterministic.
* [ ] Boolean encoding is explicit.
* [ ] No training-oriented mutation of Gold occurs.
* [ ] No missing-indicator expansion exists in V1 unless explicitly versioned.
* [ ] No categorical encoder is introduced without contract support.
* [ ] Preprocessing artifact contains exact feature order.
* [ ] Preprocessing artifact contains medians.
* [ ] Preprocessing artifact contains means.
* [ ] Preprocessing artifact contains scales.
* [ ] Preprocessing artifact contains label encoding.
* [ ] Preprocessing artifact contains preprocessing version.
* [ ] Preprocessing artifact references split ID.
* [ ] Transformed TRAIN tensor contains no NaN/Inf.
* [ ] Transformed VALIDATION tensor contains no NaN/Inf.
* [ ] Model input tensors use float32.
* [ ] Label tensors use float32 binary encoding.
* [ ] `candidate-tabular-mlp-v1` exists.
* [ ] Candidate model architecture is versioned.
* [ ] Input dimension matches feature count.
* [ ] Model produces one binary logit per row.
* [ ] `BCEWithLogitsLoss` is used.
* [ ] No duplicate Sigmoid is applied inside loss path.
* [ ] TRAIN DataLoader uses deterministic seeded shuffle.
* [ ] VALIDATION DataLoader does not shuffle.
* [ ] Training seed initializes relevant Python/NumPy/PyTorch randomness.
* [ ] Split seed is not conflated with training seed.
* [ ] CPU training works.
* [ ] CUDA is optional.
* [ ] `device=auto` supports CPU fallback.
* [ ] Explicit unavailable CUDA request fails clearly.
* [ ] Model comfortably fits 4 GB VRAM.
* [ ] No distributed-training framework is introduced.
* [ ] `balanced-bce-v1` or chosen explicit class-weight policy exists.
* [ ] Class weighting uses TRAIN counts only.
* [ ] No validation counts affect class weighting.
* [ ] No SMOTE exists.
* [ ] No oversampling exists.
* [ ] No undersampling exists.
* [ ] Optimizer is explicit.
* [ ] Learning rate is explicit.
* [ ] Weight decay is explicit.
* [ ] Maximum epoch count is bounded.
* [ ] Early stopping exists.
* [ ] Early stopping uses VALIDATION only.
* [ ] Early stopping never uses golden test.
* [ ] Best epoch is recorded.
* [ ] Best validation-loss state is restored/stored.
* [ ] Development validation loss is recorded.
* [ ] Development validation PR-AUC is recorded.
* [ ] Development validation ROC-AUC is recorded.
* [ ] Diagnostic precision/recall/F1 are clearly threshold-labelled.
* [ ] Threshold 0.5 is not treated as production threshold.
* [ ] Golden test is not loaded.
* [ ] Recent holdout is not loaded.
* [ ] Accuracy is not presented as the sole/primary model metric.
* [ ] Training configuration is canonicalized.
* [ ] Deterministic training-spec fingerprint exists.
* [ ] Gold snapshot ID participates in training-spec fingerprint.
* [ ] Split ID participates in training-spec fingerprint.
* [ ] Dataset-view fingerprint participates in training-spec fingerprint.
* [ ] Model version participates in training-spec fingerprint.
* [ ] Preprocessing version participates in training-spec fingerprint.
* [ ] Training seed participates in training-spec fingerprint.
* [ ] Model-affecting hyperparameters participate in fingerprint.
* [ ] Log level does not affect training-spec fingerprint.
* [ ] MinIO hostname does not affect training-spec fingerprint.
* [ ] Training run ID is distinguished from training-spec fingerprint.
* [ ] Each concrete execution has a training run ID.
* [ ] `training-runs/candidate/<training-run-id>/` exists.
* [ ] Native `model.pt` is persisted.
* [ ] Native model SHA256 is persisted.
* [ ] `preprocessing.json` is persisted.
* [ ] Preprocessing SHA256 is persisted.
* [ ] `metrics.json` is persisted.
* [ ] Development metrics are clearly labelled as validation metrics.
* [ ] No golden-test metrics exist in Phase 6.2 artifacts.
* [ ] Training run manifest is persisted.
* [ ] Training run manifest is written after final artifacts verify.
* [ ] Training run manifest is immutable.
* [ ] Training run manifest references exact Gold snapshot.
* [ ] Training run manifest references Gold manifest SHA.
* [ ] Training run manifest references exact split.
* [ ] Training run manifest references split manifest SHA.
* [ ] Training run manifest records dataset-view version/fingerprint.
* [ ] Training run manifest records exact feature order.
* [ ] Training run manifest records model version.
* [ ] Training run manifest records preprocessing version.
* [ ] Training run manifest records training seed.
* [ ] Training run manifest records hyperparameters.
* [ ] Training run manifest records TRAIN/VALIDATION counts.
* [ ] Training run manifest records class counts.
* [ ] Training run manifest records best epoch.
* [ ] Training run manifest records device/runtime versions.
* [ ] `contracts/data/training-run-v1.md` exists.
* [ ] `checkpoints/ml-training/candidate/` exists.
* [ ] Python owns ML-training checkpoint writes.
* [ ] ML-training checkpoint has schema version.
* [ ] `PLANNED` state exists.
* [ ] `TRAINING` state exists.
* [ ] `ARTIFACT_STORED` state exists.
* [ ] `COMPLETED` state exists.
* [ ] `FAILED` state exists.
* [ ] Checkpoint is written before expensive training begins.
* [ ] Checkpoint failure before training stops the run.
* [ ] V1 does not require mid-epoch optimizer resume.
* [ ] TRAINING crash can restart from epoch 0.
* [ ] ARTIFACT_STORED recovery can commit manifest without retraining.
* [ ] Valid manifest can repair missing/stale COMPLETED checkpoint.
* [ ] Checkpoint COMPLETED without valid manifest is not trusted.
* [ ] Committed model corruption is detected.
* [ ] Committed preprocessing corruption is detected.
* [ ] Committed run artifacts are not silently overwritten.
* [ ] Gold artifacts remain unchanged during training.
* [ ] Split manifest remains unchanged during training.
* [ ] Synthetic training-loop test passes.
* [ ] MLP shape tests pass.
* [ ] Label encoding tests pass.
* [ ] UNRESOLVED exclusion test passes.
* [ ] TRAIN median test passes.
* [ ] validation-does-not-affect-median test passes.
* [ ] TRAIN-only standardization test passes.
* [ ] validation-does-not-affect-scaling test passes.
* [ ] constant-feature test passes.
* [ ] preprocessing serialization test passes.
* [ ] preprocessing finite-output test passes.
* [ ] class-weight TRAIN-only test passes.
* [ ] deterministic DataLoader test passes.
* [ ] training-spec fingerprint stability test passes.
* [ ] hyperparameter fingerprint-change test passes.
* [ ] training-seed fingerprint-change test passes.
* [ ] loss-improvement test passes.
* [ ] early-stopping test passes.
* [ ] best-epoch restore test passes.
* [ ] PR-AUC metric test passes.
* [ ] ROC-AUC metric test passes.
* [ ] split/Gold compatibility tests pass.
* [ ] same-TIC leakage preflight test passes.
* [ ] training-run manifest round-trip test passes.
* [ ] artifact checksum tests pass.
* [ ] checkpoint serialization tests pass.
* [ ] checkpoint recovery tests pass.
* [ ] Stage 5 candidate Gold integration test passes.
* [ ] Stage 6.1 split integration test passes.
* [ ] Gold-only storage access integration test passes.
* [ ] ClickHouse-offline training test passes.
* [ ] NATS-offline training test passes.
* [ ] network-offline training test passes.
* [ ] CPU-only training test passes.
* [ ] RAW_DELETED-derived Gold training test passes.
* [ ] crash-after-PLANNED recovery passes.
* [ ] crash-during-TRAINING recovery passes.
* [ ] crash-after-artifacts-before-manifest recovery passes.
* [ ] crash-after-manifest-before-COMPLETED recovery passes.
* [ ] MinIO model-upload failure is safe.
* [ ] MinIO manifest failure leaves run uncommitted.
* [ ] No model registry package is created yet.
* [ ] No champion pointer exists.
* [ ] No challenger promotion occurs.
* [ ] No production threshold is frozen.
* [ ] No ONNX artifact exists.
* [ ] Rust inference remains unchanged.
* [ ] No prediction storage exists.
* [ ] No prediction NATS event exists.
* [ ] No Go API ML change exists.
* [ ] No dashboard ML change exists.
* [ ] `docs/ML_TRAINING.md` exists.
* [ ] `docs/ML_DATASETS.md` reflects split -> training boundary.
* [ ] `docs/CHECKPOINTS.md` includes ML-training ownership/state semantics.
* [ ] `docs/CONFIGURATION.md` documents implemented candidate training settings.
* [ ] Python README documents candidate training flow.
* [ ] Contracts README includes `training-run-v1`.
* [ ] STRUCTURE.md reflects actual added files.
* [ ] Existing Stage 5 and Phase 6.1 tests still pass.
* [ ] Repository is ready for Phase 6.3.

---

# Out of Scope

Do NOT implement in Phase 6.2:

* 1D light-curve CNN as critical path
* TPF CNN
* raw Silver tensor training
* anomaly model training
* golden test creation
* golden test evaluation
* recent holdout
* production threshold selection
* hyperparameter sweep
* Optuna
* Ray Tune
* distributed training
* SMOTE
* row-level random split
* label-derived feature selection
* optimizer-state resume framework
* epoch-by-epoch remote checkpointing
* model registry promotion
* champion pointer
* challenger promotion decision
* rollback
* model-manifest-v1
* model-runtime-v1
* ONNX export
* Rust inference parity
* prediction storage
* prediction NATS events
* Go API inference endpoints
* dashboard prediction UI
* scientific planet confirmation

---

# Next

```text
Stage 6 — Machine Learning Training, Evaluation & Model Registry

Phase 6.1  ML Dataset View & Deterministic Group Split        [DONE]

Phase 6.2  Candidate Vetting Model Training                   [DONE]

Phase 6.3  Astronomical Anomaly Detection Training
```

```
```
