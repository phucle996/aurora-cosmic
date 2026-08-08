````md id="phase-6-6"
# CHECKLIST_PHASE_6_6.md

# Stage 6 — Machine Learning Training, Evaluation & Model Registry
## Phase 6.6 — ONNX Export & Rust Inference Parity

Status: TODO

Goal:

> Convert an explicitly selected evaluated registry model into an immutable
> ONNX runtime package and prove that Python and Rust produce numerically
> equivalent inference behavior.
>
> Phase 6.6 validates the complete runtime boundary:
>
>     registered model
>          +
>     TRAIN-fitted preprocessing
>          +
>     Phase 6.4 threshold
>          |
>          v
>     ONNX runtime package
>          |
>          +--> Python native model
>          |
>          +--> Python ONNX Runtime
>          |
>          +--> Rust ONNX Runtime
>          |
>          v
>     parity-qualified runtime package
>
> Candidate runtime semantics:
>
>     raw Gold-style scalar features
>         ->
>     frozen preprocessing
>         ->
>     ONNX logit
>         ->
>     sigmoid score
>         ->
>     evaluation threshold
>
> Anomaly runtime semantics:
>
>     raw Gold-style scalar features
>         ->
>     frozen preprocessing
>         ->
>     ONNX reconstruction
>         ->
>     reconstruction MSE
>         ->
>     evaluation threshold
>
> Important:
>
>     Phase 6.5 registry model package remains immutable.
>
> ONNX is a DERIVED runtime representation.
>
> Do NOT add `model.onnx` into the immutable Phase 6.5 model package.
>
> Do NOT serve production predictions yet.
> Do NOT create prediction storage yet.
> Do NOT create prediction NATS events yet.
> Do NOT automatically deploy a runtime package.
> Do NOT add inference checkpoint state yet.

---

# 1. Input Boundary

Runtime export requires:

```text
registered model_id
+
completed evaluation_run_id
````

The evaluation must reference the exact:

```text id="rt001"
training run

native model

preprocessing artifact
```

of the registered model.

---

# 2. Explicit Runtime Selection

Core V1 command should use explicit immutable IDs:

```bash id="rt002"
python -m aurora_ml.main export-runtime \
    --model-id <model-id> \
    --evaluation-run-id <evaluation-run-id>
```

Do not silently export:

```text id="rt003"
latest model

latest evaluation
```

---

# 3. Champion Convenience

Optional convenience may support:

```bash id="rt004"
python -m aurora_ml.main export-runtime \
    --task candidate \
    --champion
```

but it MUST resolve and log the exact:

```text id="rt005"
model_id

evaluation_run_id

decision_id
```

before export.

The immutable package identity is based on resolved artifacts, not the mutable
champion pointer itself.

---

# 4. Registry Champion vs Runtime

Freeze:

```text id="rt006"
Phase 6.5 registry champion
    =
evaluation-selected model
```

```text id="rt007"
Phase 6.6 runtime-qualified package
    =
ONNX representation with Python/Rust parity evidence
```

These are different states.

---

# 5. No Automatic Deployment

Creating a runtime package does NOT mean:

```text id="rt008"
production inference is now using it
```

Deployment/serving belongs to Stage 7.

---

# 6. Source Model Package Is Read-Only

Phase 6.6 may read:

```text id="rt009"
models/candidate/<model-id>/
```

or:

```text id="rt010"
models/anomaly/<model-id>/
```

It must NEVER modify them.

---

# 7. Evaluation Package Is Read-Only

Phase 6.6 reads:

```text id="rt011"
evaluations/runs/<task>/<evaluation-run-id>/
```

to obtain:

```text id="rt012"
threshold

evaluation policy

model/evaluation provenance
```

It must never modify the evaluation run.

---

# 8. Training Run Is Read-Only

Runtime export may inspect the source training manifest if needed to rebuild
the native PyTorch architecture.

Do not modify:

```text id="rt013"
training-runs/
```

---

# 9. Gold Access

Runtime export may read the source model's:

```text id="rt014"
training Gold snapshot
+
development split
```

ONLY to create deterministic parity input cases.

It does not recompute model training.

---

# 10. No Bronze

Expected:

```text id="rt015"
Bronze reads = 0
```

---

# 11. No Silver

Expected:

```text id="rt016"
Silver reads = 0
```

---

# 12. No ClickHouse Requirement

Export/parity must work with:

```text id="rt017"
ClickHouse offline
```

---

# 13. No Live Catalog Requirement

No:

```text id="rt018"
TIC

TOI

TCE
```

network requests.

---

# 14. No NATS Requirement

Runtime export and parity validation do not depend on:

```text id="rt019"
JetStream
```

---

# 15. Python Ownership

Existing:

```text id="rt020"
aurora_ml/export_onnx.py
```

now owns:

```text id="rt021"
native model reconstruction

ONNX export

ONNX structural validation

Python native-vs-ONNX parity

runtime package materialization

runtime manifest generation
```

---

# 16. Registry Ownership Remains Separate

Existing:

```text id="rt022"
registry.py
```

continues to own:

```text id="rt023"
registered model resolution

champion resolution

registry package integrity
```

Do not move registry promotion logic into `export_onnx.py`.

---

# 17. Rust Ownership

Existing:

```text id="rt024"
apps/rust-inference/
```

owns:

```text id="rt025"
runtime manifest parsing

runtime package verification

preprocessing parity

ONNX Runtime execution

candidate score calculation

anomaly score calculation

threshold application

Rust parity validation record
```

---

# 18. No Rust Scientific Feature Engineering

Rust inference does NOT recompute:

```text id="rt026"
BLS

LC statistics

TPF deficit features

TIC enrichment
```

It receives already constructed scalar feature values.

---

# 19. Runtime Package Storage

Use permanent MinIO model plane:

```text id="rt027"
models/runtime/
```

Recommended:

```text id="rt028"
models/runtime/
├── candidate/
│   └── <runtime-package-id>/
│       ├── model.onnx
│       ├── preprocessing.json
│       ├── threshold.json
│       ├── parity-fixture.json
│       └── manifest.json
│
└── anomaly/
    └── <runtime-package-id>/
        ├── model.onnx
        ├── preprocessing.json
        ├── threshold.json
        ├── parity-fixture.json
        └── manifest.json
```

---

# 20. Runtime Package Is Immutable

Once:

```text id="rt029"
manifest.json
```

exists:

```text id="rt030"
model.onnx

preprocessing.json

threshold.json

parity-fixture.json

manifest.json
```

are immutable.

---

# 21. Runtime Package Is Separate From Registry Model

Do NOT write:

```text id="rt031"
models/candidate/<model-id>/model.onnx
```

or:

```text id="rt032"
models/anomaly/<model-id>/model.onnx
```

---

# 22. Why Separate Runtime Package

The same registered native model may be exported under:

```text id="rt033"
different ONNX exporter version

different ONNX opset

different evaluated threshold
```

without changing:

```text id="rt034"
model_id
```

---

# 23. Runtime Package Includes Threshold

Unlike Phase 6.5 native model identity:

```text id="rt035"
runtime behavior
```

depends on the selected evaluation threshold.

Therefore:

```text id="rt036"
threshold artifact
```

is part of runtime package identity.

---

# 24. Candidate Runtime Package

Source:

```text id="rt037"
candidate registered model

candidate evaluation run
```

Expected native version:

```text id="rt038"
candidate-tabular-mlp-v1
```

---

# 25. Anomaly Runtime Package

Source:

```text id="rt039"
anomaly registered model

anomaly evaluation run
```

Expected native version:

```text id="rt040"
anomaly-lightcurve-autoencoder-v1
```

---

# 26. Runtime Contract

Create:

```text id="rt041"
contracts/data/model-runtime-v1.md
```

---

# 27. Runtime Contract Purpose

Document cross-language:

```text id="rt042"
runtime package layout

manifest fields

feature order

raw input semantics

preprocessing semantics

ONNX tensor names

ONNX tensor shapes

candidate score formula

anomaly score formula

threshold semantics

artifact integrity
```

Python and Rust independently follow this contract.

---

# 28. Runtime Validation Contract

Create:

```text id="rt043"
contracts/data/model-runtime-validation-v1.md
```

This records durable evidence that:

```text id="rt044"
Rust runtime
```

agrees with the Python-generated runtime package.

---

# 29. No Shared Python/Rust Library

Do NOT create a shared business library.

Cross-language agreement comes from:

```text id="rt045"
model-runtime-v1

model-runtime-validation-v1
```

---

# 30. ONNX Export Version

Introduce:

```text id="rt046"
onnx-export-v1
```

This freezes:

```text id="rt047"
opset

input/output naming

dynamic batch semantics

export mode

preprocessing-outside-ONNX semantics
```

---

# 31. ONNX Opset

Freeze V1:

```text id="rt048"
opset = 17
```

Do not rely on the framework's changing default opset.

---

# 32. Exporter Mode

Use one explicit PyTorch ONNX exporter mode supported by the pinned project
PyTorch version.

Do not rely on a future-changing implicit exporter default.

Document it under:

```text id="rt049"
onnx-export-v1
```

---

# 33. No ONNX Simplifier V1

Do NOT introduce:

```text id="rt050"
onnx-simplifier

graph optimizer rewriting pipeline
```

unless required by a measured runtime problem.

Keep the first runtime graph transparent.

---

# 34. Preprocessing Remains Outside ONNX

V1 freezes:

```text id="rt051"
raw features
    |
    v
external preprocessing.json logic
    |
    v
float32 ONNX tensor
```

Do NOT embed imputation/scaling inside the ONNX graph in V1.

---

# 35. Why External Preprocessing

This allows explicit Python/Rust parity for:

```text id="rt052"
feature order

null handling

imputation

standardization
```

and keeps model graph simple.

---

# 36. Runtime Feature Order

Use exact:

```text id="rt053"
feature_names
```

from the registered model manifest.

No sorting.

No inference from JSON key order.

---

# 37. Runtime Feature Specs

Runtime manifest should include self-contained ordered:

```text id="rt054"
feature_specs
```

Conceptual entry:

```text id="rt055"
name

input_kind

nullable
```

V1 input kinds:

```text id="rt056"
numeric

boolean
```

only if boolean MODEL_INPUT values exist.

---

# 38. Do Not Infer Input Types From Values

Rust must not decide:

```text id="rt057"
this looks like integer so maybe boolean
```

Use runtime contract metadata.

---

# 39. Runtime Raw Input Shape

Conceptually one inference case contains:

```json id="rt060"
{
  "features": {
    "feature_a": 1.2,
    "feature_b": null,
    "feature_c": true
  }
}
```

The actual implementation may use typed Rust/Python structures.

---

# 40. Missing Key vs Null

Freeze distinction:

```text id="rt061"
missing feature key
    =
invalid runtime input
```

```text id="rt062"
feature key present with null
    =
allowed only when contract/preprocessing supports imputation
```

---

# 41. Unknown Feature Key

V1 strict runtime validation:

```text id="rt063"
unknown extra feature key
    ->
reject
```

This catches schema mismatches early.

---

# 42. Runtime Preprocessing Version

Candidate:

```text id="rt064"
candidate-preprocess-v1
```

Anomaly:

```text id="rt065"
anomaly-lightcurve-preprocess-v1
```

Unknown preprocessing versions fail.

---

# 43. Numeric Runtime Preprocessing

For numeric feature:

```text id="rt066"
raw value
```

If null:

```text id="rt067"
value = TRAIN median
```

Then:

```text id="rt068"
z =
(value - TRAIN mean)
/
TRAIN scale
```

---

# 44. Runtime Numerical Precision

V1 preprocessing calculations:

```text id="rt069"
parse raw numeric as float64

impute/standardize in float64

cast final model vector to float32
```

Python and Rust must match this order.

---

# 45. Boolean Runtime Encoding

If boolean model inputs exist:

```text id="rt070"
false -> 0.0

true  -> 1.0
```

Then apply any frozen TRAIN preprocessing parameters exactly as specified by
the preprocessing artifact.

---

# 46. Nonfinite Raw Runtime Input

Reject:

```text id="rt071"
NaN

+Inf

-Inf
```

from runtime input.

Null is the only missing-value representation.

---

# 47. Final ONNX Input Must Be Finite

Before session execution:

```text id="rt072"
all float32 values finite
```

Mandatory.

---

# 48. Candidate ONNX Input

Freeze:

```text id="rt073"
input_name = "features"
```

Shape:

```text id="rt074"
[batch, feature_count]
```

Dtype:

```text id="rt075"
float32
```

---

# 49. Candidate Dynamic Axis

Only:

```text id="rt076"
batch dimension
```

is dynamic.

Feature dimension is fixed.

---

# 50. Candidate ONNX Output

Freeze:

```text id="rt077"
output_name = "logits"
```

Shape:

```text id="rt078"
[batch]
```

Dtype:

```text id="rt079"
float32
```

---

# 51. Candidate Runtime Score

Introduce:

```text id="rt080"
candidate-sigmoid-score-v1
```

Formula:

```text id="rt081"
score = sigmoid(logit)
```

---

# 52. Stable Sigmoid

Implement numerically stable sigmoid.

Conceptually:

```text id="rt082"
if logit >= 0:

    score =
        1 / (1 + exp(-logit))

else:

    e = exp(logit)

    score =
        e / (1 + e)
```

Use equivalent stable implementation in Python/Rust.

---

# 53. Candidate Score Semantics

Candidate score is:

```text id="rt083"
classifier score in [0,1]
```

Do NOT call it:

```text id="rt084"
planet confirmation probability
```

---

# 54. Candidate Threshold

Load exact Phase 6.4:

```text id="rt085"
decision_threshold
```

from the selected evaluation artifact.

---

# 55. Candidate Threshold Validation

Require:

```text id="rt086"
0 <= threshold <= 1
```

---

# 56. Candidate Runtime Flag

Freeze:

```text id="rt087"
above_threshold =
score >= threshold
```

---

# 57. Candidate Runtime Output Semantics

Parity/runtime code may produce:

```text id="rt088"
logit

score

threshold

above_threshold
```

Do not call:

```text id="rt089"
above_threshold=true
```

a scientifically confirmed planet.

---

# 58. Anomaly ONNX Input

Freeze:

```text id="rt090"
input_name = "features"
```

Shape:

```text id="rt091"
[batch, feature_count]
```

Dtype:

```text id="rt092"
float32
```

---

# 59. Anomaly ONNX Output

Freeze:

```text id="rt093"
output_name = "reconstruction"
```

Shape:

```text id="rt094"
[batch, feature_count]
```

Dtype:

```text id="rt095"
float32
```

---

# 60. Anomaly Runtime Score

Reuse exact:

```text id="rt096"
reconstruction-mse-v1
```

---

# 61. Anomaly Score Formula

For each row:

```text id="rt097"
score =
mean(
    (standardized_input - reconstruction)^2
)
```

---

# 62. Anomaly Score Space

Score remains:

```text id="rt098"
standardized feature space reconstruction error
```

---

# 63. Anomaly Threshold

Load exact Phase 6.4:

```text id="rt099"
validation p99 threshold
```

---

# 64. Anomaly Threshold Validation

Require:

```text id="rt100"
threshold >= 0
```

and finite.

---

# 65. Anomaly Runtime Flag

Freeze:

```text id="rt101"
above_threshold =
score >= threshold
```

---

# 66. Anomaly Output Is Not Probability

Do NOT expose:

```text id="rt102"
anomaly_probability
```

for V1.

---

# 67. Native Model Reconstruction

Python exporter rebuilds model architecture from exact:

```text id="rt103"
model_version
```

and:

```text id="rt104"
feature_count
```

Then loads verified:

```text id="rt105"
state_dict
```

---

# 68. No Pickled Whole Model Dependency

Do not require deserializing a whole arbitrary Python class object as the only
export path.

Use:

```text id="rt106"
versioned model constructor
+
state_dict
```

---

# 69. Native Model Evaluation Mode

Before ONNX export:

```text id="rt107"
model.eval()
```

Mandatory.

---

# 70. Export Device

Recommended V1 export:

```text id="rt108"
CPU
```

even if training happened on CUDA.

Move model state to CPU before export.

---

# 71. Why CPU Export

It provides a portable deterministic reference path independent of GPU
availability.

---

# 72. Export Dummy Tensor

Shape:

```text id="rt109"
[2, feature_count]
```

or another small batch > 1.

This validates dynamic batch semantics during export.

---

# 73. ONNX Structural Validation

After export run:

```text id="rt110"
onnx.checker.check_model(...)
```

or equivalent official ONNX checker.

---

# 74. ONNX Input Metadata Verification

Verify actual graph input:

```text id="rt111"
name

dtype

rank

fixed feature dimension
```

matches runtime contract.

---

# 75. ONNX Output Metadata Verification

Same for output.

---

# 76. Unknown Extra ONNX Inputs

Runtime package V1 should reject an unexpected extra required graph input.

---

# 77. Python ONNX Runtime

Declare/use:

```text id="rt112"
onnxruntime
```

with:

```text id="rt113"
CPUExecutionProvider
```

for mandatory parity.

---

# 78. Python Dependencies

Ensure:

```text id="rt114"
onnx

onnxruntime
```

are declared/pinned according to project dependency strategy in:

```text id="rt115"
pyproject.toml
```

---

# 79. No GPU Python Parity Requirement

CPU parity is mandatory.

CUDA ONNX Runtime parity is optional/manual.

---

# 80. Python Parity Policy

Introduce:

```text id="rt116"
python-native-onnx-parity-v1
```

---

# 81. Python Parity Tolerance

Mandatory CPU tolerance:

```text id="rt117"
atol = 1e-5

rtol = 1e-5
```

for ONNX model outputs.

---

# 82. Candidate Python Parity

Compare:

```text id="rt118"
PyTorch native logits
```

against:

```text id="rt119"
Python ONNX Runtime logits
```

---

# 83. Candidate Python Score Parity

Also compare:

```text id="rt120"
native sigmoid score
```

and:

```text id="rt121"
ONNX-logit-derived sigmoid score
```

---

# 84. Anomaly Python Parity

Compare:

```text id="rt122"
native reconstruction
```

against:

```text id="rt123"
ONNX Runtime reconstruction
```

---

# 85. Anomaly Python Score Parity

Compare:

```text id="rt124"
native reconstruction MSE
```

against:

```text id="rt125"
ONNX reconstruction MSE
```

---

# 86. Python Parity Failure

If tolerance fails:

```text id="rt126"
DO NOT COMMIT RUNTIME PACKAGE
```

Return:

```text id="rt127"
PYTHON_ONNX_PARITY_FAILED
```

---

# 87. Runtime Package Requires Python Parity

Every committed runtime package must have:

```text id="rt128"
python_native_onnx_parity = PASS
```

recorded in its immutable manifest.

---

# 88. Parity Fixture

Create:

```text id="rt129"
parity-fixture.json
```

inside runtime package.

---

# 89. Parity Fixture Purpose

It provides deterministic cross-language test cases for:

```text id="rt130"
raw feature parsing

feature ordering

null handling

preprocessing

ONNX output

runtime score

threshold result
```

---

# 90. Parity Fixture Version

Introduce:

```text id="rt131"
runtime-parity-fixture-v1
```

---

# 91. Base Parity Rows

Select deterministic development rows from the model's original split:

```text id="rt132"
VALIDATION
```

not Golden Test.

---

# 92. Why VALIDATION Rows

They are:

```text id="rt133"
already development-exposed
```

so runtime engineering does not consume the frozen Golden Test for
implementation debugging.

---

# 93. Parity Row Ordering

Select candidate rows by:

```text id="rt134"
source_product_id ASC
```

---

# 94. Parity Base Sample Count

Recommended V1:

```text id="rt135"
first 8 VALIDATION rows
```

If fewer than 8 exist:

```text id="rt136"
use all available
```

Require at least:

```text id="rt137"
1
```

row.

---

# 95. No Random Parity Row Selection

Do not use random sampling.

---

# 96. Parity Fixture Input

For each case store raw ordered feature values semantically as:

```text id="rt138"
numeric

boolean

null
```

not the already standardized tensor only.

---

# 97. Feature-Order Canary

At least one fixture case must exercise every input position across the fixture
set where practical.

This helps catch:

```text id="rt139"
feature permutation bugs
```

---

# 98. Nullable Feature Cases

For up to the first:

```text id="rt140"
4 nullable model features
```

in contractual feature order, add deterministic synthetic parity cases derived
from the first base validation row with:

```text id="rt141"
that one feature = null
```

---

# 99. Null Fixture Is Runtime-Test Data Only

Do NOT write these synthetic null variants back into:

```text id="rt142"
Gold
```

---

# 100. Parity Fixture Expected Preprocessing

Python exporter stores expected:

```text id="rt143"
preprocessed float32 vector
```

for each fixture case.

---

# 101. Candidate Parity Fixture Expected Output

Store expected Python ONNX Runtime:

```text id="rt144"
logit

score

above_threshold
```

---

# 102. Anomaly Parity Fixture Expected Output

Store expected:

```text id="rt145"
reconstruction vector

anomaly score

above_threshold
```

---

# 103. Why Python ORT Is Cross-Language Reference

The Rust parity target is primarily:

```text id="rt146"
Python ONNX Runtime
```

because both are executing the exact same ONNX graph.

Native PyTorch parity has already been checked before package commit.

---

# 104. Parity Fixture Does Not Store Labels

No need to store:

```text id="rt147"
POSITIVE

NEGATIVE

TOI disposition
```

for runtime parity.

---

# 105. Parity Fixture SHA

Compute:

```text id="rt148"
parity_fixture_sha256
```

and reference it in runtime manifest.

---

# 106. Preprocessing Copy

Runtime package receives exact verified:

```text id="rt149"
preprocessing.json
```

bytes from registered model package.

---

# 107. Do Not Re-serialize Preprocessing

Prefer exact byte copy so:

```text id="rt150"
runtime preprocessing SHA
==
registered preprocessing SHA
```

---

# 108. Threshold Copy

Runtime package receives exact verified:

```text id="rt151"
threshold.json
```

bytes from selected Phase 6.4 evaluation.

---

# 109. Do Not Recompute Threshold

Forbidden:

```text id="rt152"
rerun validation threshold selection
```

during ONNX export.

---

# 110. Threshold SHA

Require:

```text id="rt153"
runtime threshold SHA
==
evaluation threshold SHA
```

---

# 111. ONNX SHA

Compute:

```text id="rt154"
onnx_sha256
```

and:

```text id="rt155"
onnx_size_bytes
```

---

# 112. Runtime Manifest

Create immutable:

```text id="rt156"
manifest.json
```

using:

```text id="rt157"
model-runtime-v1
```

---

# 113. Runtime Manifest Fields

Conceptual:

```text id="rt158"
schema_version

runtime_package_id

runtime_fingerprint

task

source_model_id

source_model_manifest_key

source_model_manifest_sha256

source_training_run_id

source_evaluation_run_id

source_evaluation_manifest_sha256

source_selection_decision_id

model_version

dataset_view_version

dataset_view_fingerprint

feature_specs

feature_names

preprocessing_version

preprocessing_key

preprocessing_sha256

threshold_policy_version

threshold_key

threshold_sha256

score_definition_version

onnx_export_version

onnx_opset

onnx_input_name

onnx_input_dtype

onnx_input_shape

onnx_output_name

onnx_output_dtype

onnx_output_shape

onnx_key

onnx_sha256

onnx_size_bytes

parity_fixture_version

parity_fixture_key

parity_fixture_sha256

python_parity_policy_version

python_parity_atol

python_parity_rtol

python_parity_max_abs_error

python_parity_max_rel_error

python_parity_status

created_at

producer
```

Task-specific irrelevant fields may be absent/null.

---

# 114. Selection Decision Is Metadata

If runtime package is exported through current champion resolution:

```text id="rt159"
source_selection_decision_id
```

may be recorded.

It does NOT need to participate in package identity.

---

# 115. Why Decision Excluded From Runtime Identity

The same:

```text id="rt160"
model

evaluation threshold

ONNX bytes
```

selected again through rollback should resolve to the same runtime package.

---

# 116. Runtime Package Fingerprint

Compute deterministic:

```text id="rt161"
SHA256(
    task
    +
    source model ID / manifest SHA
    +
    source evaluation ID / manifest SHA
    +
    preprocessing SHA
    +
    threshold SHA
    +
    exact feature specs/order
    +
    model version
    +
    score semantics
    +
    onnx-export-v1
    +
    opset
    +
    ONNX SHA
    +
    parity-fixture SHA
)
```

---

# 117. Runtime Package ID

Recommended:

```text id="rt162"
runtime-v1-<sha-prefix>
```

Persist full fingerprint.

---

# 118. Runtime ID Does Not Depend On Time

Exclude:

```text id="rt163"
created_at

hostname

temporary path
```

---

# 119. Runtime ID Includes ONNX Bytes

If different exporter/runtime versions produce different:

```text id="rt164"
ONNX SHA
```

they become different runtime package IDs.

This is desirable.

---

# 120. Same Model, Different Threshold

If a model is re-evaluated and threshold changes:

```text id="rt165"
new runtime package ID
```

even when ONNX bytes are identical.

---

# 121. Same Model, Same Evaluation, Same Export

Expected:

```text id="rt166"
same runtime package ID
```

---

# 122. Runtime Commit Ordering

Required:

```text id="rt167"
verify registry model/evaluation
      |
      v
build native CPU model
      |
      v
generate deterministic parity fixture inputs
      |
      v
export local ONNX
      |
      v
ONNX checker
      |
      v
Python native-vs-ORT parity
      |
      v
write ONNX to MinIO
      |
      v
verify ONNX
      |
      v
copy preprocessing
      |
      v
verify
      |
      v
copy threshold
      |
      v
verify
      |
      v
write parity fixture
      |
      v
verify
      |
      v
write runtime manifest LAST
```

---

# 123. Manifest Is Runtime Package Commit Marker

Without:

```text id="rt168"
manifest.json
```

the runtime package is:

```text id="rt169"
NOT COMMITTED
```

---

# 124. Partial Runtime Export

If:

```text id="rt170"
model.onnx exists
manifest missing
```

runtime package must not be selected for Rust validation/serving.

---

# 125. Existing Identical Runtime Package

If all exact artifacts verify:

```text id="rt171"
reuse
```

No re-upload needed.

---

# 126. Existing Runtime Conflict

Same deterministic package ID with incompatible bytes:

```text id="rt172"
RUNTIME_PACKAGE_CONFLICT
```

Never overwrite.

---

# 127. No Runtime Package Current Pointer

Do NOT create:

```text id="rt173"
models/runtime/candidate/current.json

models/runtime/anomaly/current.json
```

in Phase 6.6.

Stage 7 owns runtime deployment selection.

---

# 128. No Champion Pointer Mutation

Export does not modify:

```text id="rt174"
models/<task>/champion.json
```

---

# 129. Python Export Error Codes

Keep compact:

```text id="rt175"
INVALID_REGISTERED_MODEL

INVALID_MODEL_EVALUATION

MODEL_EVALUATION_MISMATCH

UNSUPPORTED_MODEL_VERSION

UNSUPPORTED_PREPROCESSING_VERSION

INVALID_THRESHOLD

ONNX_EXPORT_FAILED

ONNX_SCHEMA_MISMATCH

PYTHON_ONNX_PARITY_FAILED

RUNTIME_PACKAGE_CONFLICT
```

---

# 130. Rust ONNX Runtime

Use the existing selected Rust ONNX Runtime integration.

If the project uses:

```text id="rt176"
ort
```

crate, keep one explicitly pinned compatible version.

Do not introduce a second inference engine.

---

# 131. Rust CPU Provider

Mandatory runtime provider:

```text id="rt177"
CPUExecutionProvider
```

or the equivalent default CPU provider from the chosen Rust ONNX Runtime
binding.

---

# 132. Rust CUDA Provider

CUDA support remains:

```text id="rt178"
optional
```

It must never be required for correctness.

---

# 133. CUDA Runtime Rule

If configured:

```text id="rt179"
provider=auto
```

and CUDA is unavailable:

```text id="rt180"
fall back to CPU
```

---

# 134. Explicit CUDA Request

If:

```text id="rt181"
provider=cuda
```

is explicitly requested but unavailable:

```text id="rt182"
fail clearly
```

---

# 135. Mandatory Runtime Qualification Uses CPU

The durable Phase 6.6 parity qualification must include:

```text id="rt183"
Rust CPU ONNX Runtime
```

This provides a universal baseline.

---

# 136. Optional CUDA Validation

A separate optional runtime validation may test CUDA.

It does NOT replace mandatory CPU validation.

---

# 137. Rust Storage

If runtime package loading from MinIO is not already implemented, add a small:

```text id="rt184"
src/storage.rs
```

only when needed.

Responsibilities:

```text id="rt185"
fetch runtime manifest

fetch ONNX

fetch preprocessing

fetch threshold

fetch parity fixture

verify bytes/checksums
```

---

# 138. Rust Storage Must Not Read Science Data

`rust-inference` storage layer does NOT fetch:

```text id="rt186"
Bronze

Silver

Gold time series

catalogs
```

for runtime parity.

---

# 139. Rust Runtime Package Resolution

Parity command receives exact:

```text id="rt187"
runtime_package_id
```

Do not resolve:

```text id="rt188"
latest runtime
```

---

# 140. Rust Does Not Resolve Registry Champion Yet

Stage 7 may resolve deployment/champion state.

Phase 6.6 validates an explicit runtime package.

---

# 141. Rust Package Verification

Before ONNX session creation verify:

```text id="rt189"
runtime manifest schema

task

ONNX SHA

preprocessing SHA

threshold SHA

parity fixture SHA
```

---

# 142. Rust ONNX File Handling

Download/copy ONNX to a bounded local file if required by the selected ORT API.

The V1 model is small.

No special giant-model streaming system is required.

---

# 143. Local File Cleanup

Remove temporary ONNX/package files on:

```text id="rt190"
success

failure

shutdown
```

where practical.

---

# 144. Rust Runtime Manifest Type

Add an explicit typed struct in existing appropriate module such as:

```text id="rt191"
model.rs
```

Do not manipulate runtime manifest as arbitrary nested JSON maps.

---

# 145. Rust Preprocessing

Implement exact:

```text id="rt192"
model-runtime-v1
```

preprocessing semantics.

Do not create independent learned parameters.

---

# 146. Rust Feature Ordering

For every input:

```text id="rt193"
runtime manifest feature_names
```

defines tensor position.

JSON/map iteration order is irrelevant.

---

# 147. Rust Missing Key

Return explicit runtime error.

---

# 148. Rust Unknown Key

V1 strict parity/runtime input:

```text id="rt194"
reject
```

---

# 149. Rust Null Numeric

Use exact:

```text id="rt195"
TRAIN median
```

from preprocessing artifact.

---

# 150. Rust Numerical Pipeline

Match Python:

```text id="rt196"
f64 parse
    |
    v
f64 impute
    |
    v
f64 standardize
    |
    v
cast f32
    |
    v
ONNX input
```

---

# 151. Rust Boolean Encoding

Match Python exactly.

No:

```text id="rt197"
false=-1

true=+1
```

unless preprocessing contract explicitly says so.

V1 expected:

```text id="rt198"
false=0

true=1
```

before frozen scaling.

---

# 152. Rust Finite Check

Before ONNX inference verify all final tensor values finite.

---

# 153. Rust Candidate Score

Compute exact:

```text id="rt199"
candidate-sigmoid-score-v1
```

---

# 154. Rust Candidate Threshold

Use exact copied Phase 6.4 threshold.

Do not use:

```text id="rt200"
0.5
```

unless the threshold artifact itself says 0.5.

---

# 155. Rust Anomaly Score

Compute exact:

```text id="rt201"
reconstruction-mse-v1
```

on standardized input and ONNX reconstruction.

---

# 156. Rust Anomaly Threshold

Use exact copied Phase 6.4 p99 threshold.

Do not recalculate from runtime requests.

---

# 157. Rust Score Precision

ONNX tensors are float32.

Runtime final scalar score may be accumulated/calculated in:

```text id="rt202"
float64
```

for stable comparison.

Document exact implementation.

---

# 158. Candidate Probability Precision

Convert logit to:

```text id="rt203"
float64
```

before stable sigmoid if that is the frozen implementation.

Python parity reference must match.

---

# 159. Rust Runtime Validation CLI

Add explicit development/qualification command.

Example:

```bash id="rt204"
aurora-rust-inference validate-runtime \
    --runtime-package-id <runtime-package-id>
```

---

# 160. Runtime Validation Is Not Server Start

The command:

```text id="rt205"
loads package

runs parity fixture

writes validation record

exits
```

It does NOT:

```text id="rt206"
connect to prediction NATS consumer

run HTTP API

serve forever
```

---

# 161. No NATS During Parity

Mandatory:

```text id="rt207"
NATS unavailable
    ->
validate-runtime still works
```

---

# 162. Runtime Validation Policy

Introduce:

```text id="rt208"
rust-onnx-parity-v1
```

---

# 163. Preprocessing Parity Tolerance

Compare Rust preprocessed float32 vectors against fixture expectations.

Recommended:

```text id="rt209"
atol = 1e-6

rtol = 1e-6
```

---

# 164. Rust ONNX Output Parity Tolerance

Mandatory CPU:

```text id="rt210"
atol = 1e-5

rtol = 1e-5
```

---

# 165. Candidate Score Parity

Recommended:

```text id="rt211"
absolute difference <= 1e-6
```

for final sigmoid score where feasible.

Use the explicitly frozen runtime validation tolerance.

---

# 166. Anomaly Score Parity

Recommended:

```text id="rt212"
atol = 1e-5

rtol = 1e-5
```

---

# 167. Threshold Decision Parity

Must be exact:

```text id="rt213"
Python above_threshold
==
Rust above_threshold
```

for every fixture case.

---

# 168. Candidate Rust Parity

For every fixture case verify:

```text id="rt214"
preprocessed vector

logit

sigmoid score

above_threshold
```

---

# 169. Anomaly Rust Parity

Verify:

```text id="rt215"
preprocessed vector

reconstruction vector

reconstruction MSE

above_threshold
```

---

# 170. Shape Parity

Rust must verify actual ONNX outputs have the expected:

```text id="rt216"
batch

feature dimensions
```

---

# 171. Nonfinite Rust Output

Any:

```text id="rt217"
NaN

Inf
```

is a validation failure.

---

# 172. Parity Case Count

Rust must run every:

```text id="rt218"
parity-fixture.json
```

case.

Do not test only the first row.

---

# 173. Rust Parity Summary

Collect:

```text id="rt219"
case_count

preprocessing_max_abs_error

preprocessing_max_rel_error

onnx_output_max_abs_error

onnx_output_max_rel_error

score_max_abs_error

decision_mismatch_count
```

---

# 174. Runtime Validation Storage

Store durable cross-language proof separately from immutable runtime package:

```text id="rt220"
models/runtime-validations/
```

Recommended:

```text id="rt221"
models/runtime-validations/
├── candidate/
│   └── <runtime-package-id>/
│       └── <validation-id>.json
│
└── anomaly/
    └── <runtime-package-id>/
        └── <validation-id>.json
```

---

# 175. Why Validation Is Separate

Runtime package may be committed after successful:

```text id="rt222"
Python native -> Python ONNX parity
```

but Rust qualification happens afterwards.

Do not mutate runtime package manifest to add Rust validation state.

---

# 176. Runtime Package May Be Unqualified

Valid state:

```text id="rt223"
runtime package committed

no Rust PASS validation yet
```

It must NOT be treated as deployment-ready.

---

# 177. Stage 7 Qualification Rule

Future Stage 7 should consume only a runtime package with at least one valid:

```text id="rt224"
PASS model-runtime-validation-v1
```

for the required runtime/provider.

---

# 178. Rust Writes Runtime Validation

Phase 6.6 ownership:

```text id="rt225"
Rust inference validator
    ->
models/runtime-validations/
```

Python owns runtime package creation.

---

# 179. Runtime Validation Fields

Conceptual:

```text id="rt226"
schema_version

validation_id

validation_fingerprint

runtime_package_id

runtime_manifest_key

runtime_manifest_sha256

task

validation_policy_version

provider

parity_fixture_sha256

case_count

preprocessing_atol

preprocessing_rtol

preprocessing_max_abs_error

preprocessing_max_rel_error

onnx_atol

onnx_rtol

onnx_output_max_abs_error

onnx_output_max_rel_error

score_max_abs_error

decision_mismatch_count

rust_runtime_version

onnx_runtime_version

git_commit

status

failure_code

validated_at

producer
```

---

# 180. Validation Status

V1:

```text id="rt227"
PASS

FAIL
```

---

# 181. Failed Validation May Be Persisted

If parity runs to completion and mismatches are discovered:

```text id="rt228"
write FAIL record
```

for audit.

---

# 182. Package Integrity Failure

If runtime package itself cannot be trusted:

```text id="rt229"
validation may fail before durable parity record
```

depending on whether a safe validation identity can be constructed.

Do not invent PASS evidence.

---

# 183. Validation Fingerprint

Compute deterministic SHA256 from:

```text id="rt230"
runtime package ID

runtime manifest SHA

validation policy version

provider

parity fixture SHA

Rust runtime version

ONNX Runtime version

tolerances
```

---

# 184. Validation ID

Example:

```text id="rt231"
runtime-validation-v1-<sha-prefix>
```

---

# 185. Validation ID Ignores Time

Exclude:

```text id="rt232"
validated_at
```

---

# 186. Same Runtime/Environment Validation

Expected:

```text id="rt233"
same validation ID
```

and idempotent reuse.

---

# 187. Different Runtime Version

A materially different:

```text id="rt234"
Rust inference / ORT runtime version
```

may produce a new validation ID.

This preserves qualification provenance.

---

# 188. PASS Record Is Immutable

Never mutate:

```text id="rt235"
PASS -> FAIL
```

later.

A new validation produces a new record.

---

# 189. Runtime Validation Conflict

Same deterministic validation ID with incompatible content:

```text id="rt236"
RUNTIME_VALIDATION_CONFLICT
```

---

# 190. Runtime Validation Does Not Deploy

Writing:

```text id="rt237"
PASS
```

does NOT update a runtime-current pointer.

---

# 191. Runtime Validation Does Not Change Champion

It does NOT change:

```text id="rt238"
models/<task>/champion.json
```

---

# 192. Rust Runtime Error Codes

Keep compact:

```text id="rt239"
INVALID_RUNTIME_MANIFEST

UNSUPPORTED_RUNTIME_SCHEMA

RUNTIME_ARTIFACT_INTEGRITY_ERROR

UNSUPPORTED_MODEL_VERSION

UNSUPPORTED_PREPROCESSING_VERSION

INVALID_RUNTIME_INPUT

FEATURE_SET_MISMATCH

NONFINITE_RUNTIME_INPUT

ONNX_SESSION_ERROR

ONNX_OUTPUT_SHAPE_ERROR

NONFINITE_ONNX_OUTPUT

RUNTIME_PREPROCESSING_PARITY_FAILED

RUNTIME_ONNX_PARITY_FAILED

RUNTIME_SCORE_PARITY_FAILED

RUNTIME_DECISION_PARITY_FAILED

RUNTIME_VALIDATION_CONFLICT
```

---

# 193. Model Version Dispatch

Rust runtime explicitly supports:

```text id="rt240"
candidate-tabular-mlp-v1

anomaly-lightcurve-autoencoder-v1
```

Do not silently accept unknown future versions.

---

# 194. Runtime Schema Dispatch

Support:

```text id="rt241"
model-runtime-v1
```

Unknown runtime manifest:

```text id="rt242"
fail
```

---

# 195. Candidate Score Version Dispatch

Support:

```text id="rt243"
candidate-sigmoid-score-v1
```

---

# 196. Anomaly Score Version Dispatch

Support:

```text id="rt244"
reconstruction-mse-v1
```

---

# 197. Threshold Policy Compatibility

Runtime package must preserve the exact selected Phase 6.4:

```text id="rt245"
threshold_policy_version
```

Rust validates it is supported for the task.

---

# 198. Candidate Supported Threshold Policy

Expected V1:

```text id="rt246"
candidate-threshold-max-f1-v1
```

---

# 199. Anomaly Supported Threshold Policy

Expected V1:

```text id="rt247"
anomaly-threshold-validation-p99-v1
```

---

# 200. No Threshold Selection In Rust

Rust inference applies the frozen value.

It does NOT rerun:

```text id="rt248"
F1 threshold search

p99 quantile calculation
```

---

# 201. Rust `runtime.rs`

Recommended ownership:

```text id="rt249"
ORT session creation

runtime input tensor execution

provider selection
```

---

# 202. Rust `model.rs`

Recommended ownership:

```text id="rt250"
runtime/model manifest types

feature/preprocessing metadata

package compatibility validation
```

---

# 203. Rust `evidence.rs`

Use only if its existing responsibility naturally maps raw feature/evidence
records into runtime inputs.

Do not dump unrelated runtime package logic into it.

---

# 204. Rust `prediction.rs`

May own pure runtime result calculations:

```text id="rt251"
stable sigmoid

candidate threshold comparison

reconstruction MSE

anomaly threshold comparison
```

No prediction persistence yet.

---

# 205. Rust `nats.rs`

Leave production NATS prediction flow unchanged unless a tiny compile fix is
required.

No new subjects.

---

# 206. Rust `app.rs`

May wire:

```text id="rt252"
validate-runtime
```

command separately from long-running inference application behavior.

Entrypoint remains wiring only.

---

# 207. No Generic Rust Helper Module

Do not add:

```text id="rt253"
utils.rs
```

for runtime business logic.

---

# 208. No Trait Explosion

Do not create:

```text id="rt254"
RuntimeStrategy

ModelFactory

ProviderFactory

ScoreStrategy
```

for two explicit V1 tasks.

Use small explicit matches/functions.

---

# 209. Rust CPU Session Test

Load candidate ONNX package.

Run:

```text id="rt255"
CPU session
```

successfully.

---

# 210. Rust Anomaly Session Test

Same.

---

# 211. Rust Feature Order Unit Test

Runtime manifest:

```text id="rt256"
[a, b, c]
```

input map inserted as:

```text id="rt257"
c, a, b
```

must still produce tensor:

```text id="rt258"
[a, b, c]
```

---

# 212. Rust Missing Feature Test

Expected:

```text id="rt259"
FEATURE_SET_MISMATCH
```

---

# 213. Rust Extra Feature Test

Expected V1 strict rejection.

---

# 214. Rust Null Numeric Test

Null feature uses exact imputation median.

---

# 215. Rust Null Forbidden Test

If non-nullable/no imputation:

```text id="rt260"
INVALID_RUNTIME_INPUT
```

---

# 216. Rust Nonfinite Test

Reject before ONNX.

---

# 217. Rust Standardization Test

Known:

```text id="rt261"
raw

median

mean

scale
```

produces expected float32 vector.

---

# 218. Rust Constant Scale Test

Exact:

```text id="rt262"
scale=1
```

behavior matches Python.

---

# 219. Rust Boolean Test

Verify exact V1 boolean encoding.

---

# 220. Stable Sigmoid Unit Test

Use:

```text id="rt263"
large positive logit

large negative logit

zero
```

Expected finite score in:

```text id="rt264"
[0,1]
```

---

# 221. Sigmoid Zero Test

```text id="rt265"
logit=0
```

Expected:

```text id="rt266"
score=0.5
```

---

# 222. Candidate Equality Threshold Test

```text id="rt267"
score == threshold
```

Expected:

```text id="rt268"
above_threshold=true
```

---

# 223. Anomaly MSE Exact Test

Input:

```text id="rt269"
[0, 2]
```

reconstruction:

```text id="rt270"
[0, 0]
```

Expected:

```text id="rt271"
score=2
```

---

# 224. Anomaly Equality Threshold Test

```text id="rt272"
score == threshold
```

Expected:

```text id="rt273"
above_threshold=true
```

---

# 225. ONNX Input Shape Test

Wrong feature dimension must fail before/at runtime clearly.

---

# 226. ONNX Output Shape Test

Candidate output not `[N]`:

```text id="rt274"
fail
```

under V1.

---

# 227. Anomaly Output Shape Test

Reconstruction dimension mismatch:

```text id="rt275"
fail
```

---

# 228. Python Unit Test — Candidate Export

Tiny candidate native model exports valid:

```text id="rt276"
opset 17
```

ONNX.

---

# 229. Python Unit Test — Anomaly Export

Tiny autoencoder exports.

---

# 230. Python Unit Test — Candidate Input Metadata

Verify:

```text id="rt277"
features

float32

[dynamic_batch, fixed_features]
```

---

# 231. Python Unit Test — Candidate Output Metadata

Verify:

```text id="rt278"
logits
```

and expected shape.

---

# 232. Python Unit Test — Anomaly Output Metadata

Verify:

```text id="rt279"
reconstruction
```

and expected shape.

---

# 233. Python Unit Test — ONNX Checker

Corrupt/invalid graph must fail package creation.

---

# 234. Python Unit Test — Candidate Native/ORT Parity

Known deterministic model/input.

Expected within:

```text id="rt280"
1e-5 atol/rtol
```

---

# 235. Python Unit Test — Anomaly Native/ORT Parity

Same.

---

# 236. Python Unit Test — Candidate Score Parity

Native and ORT-derived sigmoid scores match.

---

# 237. Python Unit Test — Anomaly Score Parity

Native and ORT reconstruction MSE match.

---

# 238. Python Unit Test — Python Parity Failure

Artificially perturb ONNX output/reference.

Expected:

```text id="rt281"
PYTHON_ONNX_PARITY_FAILED
```

No runtime manifest.

---

# 239. Python Unit Test — Threshold Copy

Runtime threshold bytes equal evaluation threshold bytes.

---

# 240. Python Unit Test — Preprocessing Copy

Runtime preprocessing bytes equal registry preprocessing bytes.

---

# 241. Python Unit Test — Runtime Fingerprint Stability

Same package inputs:

```text id="rt282"
same runtime fingerprint
```

---

# 242. Python Unit Test — Runtime Timestamp Independence

Different:

```text id="rt283"
created_at
```

same runtime ID.

---

# 243. Python Unit Test — Threshold Change

Same model/ONNX but different threshold:

```text id="rt284"
new runtime package ID
```

---

# 244. Python Unit Test — ONNX Byte Change

Different ONNX SHA:

```text id="rt285"
new runtime package ID
```

---

# 245. Python Unit Test — Feature Order Change

New runtime identity.

---

# 246. Python Unit Test — Opset Change

Simulated:

```text id="rt286"
opset 18
```

produces different runtime identity/export version semantics.

---

# 247. Python Unit Test — Existing Package Reuse

Exact package exists:

```text id="rt287"
no-op
```

---

# 248. Python Unit Test — Runtime Conflict

Same deterministic package key incompatible bytes:

```text id="rt288"
RUNTIME_PACKAGE_CONFLICT
```

---

# 249. Parity Fixture Selection Test

Validation rows:

```text id="rt289"
source C
source A
source B
```

Expected base order:

```text id="rt290"
A
B
C
```

---

# 250. Parity Fixture Determinism Test

Same training/split/preprocessing:

```text id="rt291"
same parity fixture SHA
```

---

# 251. Parity Fixture Does Not Use Golden

Instrument row selection.

Expected:

```text id="rt292"
Golden Test reads for fixture selection = 0
```

---

# 252. Parity Fixture Null Variant Test

Nullable feature variant produces expected TRAIN-median imputation.

---

# 253. Parity Fixture Feature Order Test

Expected preprocessed tensor position matches model contract.

---

# 254. Runtime Manifest Serialization Test

Round-trip all important:

```text id="rt293"
IDs

hashes

feature order

tensor metadata

threshold policy

score definition

ONNX metadata
```

---

# 255. Unknown Runtime Manifest Version Test

Python/Rust both reject unsupported runtime schema.

---

# 256. Runtime Validation Serialization Test

Rust round-trip:

```text id="rt294"
PASS

FAIL
```

records.

---

# 257. Validation ID Stability Test

Same exact runtime/provider/version:

```text id="rt295"
same validation ID
```

---

# 258. Validation Timestamp Independence

Different validation timestamp:

```text id="rt296"
same validation ID
```

---

# 259. Validation Runtime-Version Change

Expected different validation identity where version participates.

---

# 260. Validation Conflict Test

Expected:

```text id="rt297"
RUNTIME_VALIDATION_CONFLICT
```

---

# 261. Candidate Cross-Language Parity Test

Mandatory flow:

```text id="rt298"
raw fixture
   |
   +--> Python preprocessing
   |       |
   |       v
   |   Python ORT
   |
   +--> Rust preprocessing
           |
           v
       Rust ORT
```

Verify all candidate outputs.

---

# 262. Anomaly Cross-Language Parity Test

Same for anomaly reconstruction/score.

---

# 263. Preprocessing Cross-Language Parity

Mandatory:

```text id="rt299"
Python standardized float32 vector
≈
Rust standardized float32 vector
```

for every fixture case.

---

# 264. Candidate Logit Cross-Language Parity

Mandatory within V1 tolerance.

---

# 265. Candidate Score Cross-Language Parity

Mandatory.

---

# 266. Candidate Decision Cross-Language Parity

Mandatory exact boolean match.

---

# 267. Anomaly Reconstruction Cross-Language Parity

Mandatory.

---

# 268. Anomaly Score Cross-Language Parity

Mandatory.

---

# 269. Anomaly Decision Cross-Language Parity

Mandatory exact boolean match.

---

# 270. Runtime PASS Requirement

Validation status may be:

```text id="rt300"
PASS
```

only when ALL required checks pass.

---

# 271. Preprocessing Failure Means FAIL

Even if ONNX output accidentally looks close.

---

# 272. ONNX Output Failure Means FAIL

Even if final boolean decision happens to match.

---

# 273. Score Failure Means FAIL

Even if decision matches.

---

# 274. Decision Failure Means FAIL

Mandatory.

---

# 275. Candidate Integration — Registered Model

Start with actual tiny:

```text id="rt301"
Phase 6.5 registered candidate model
+
Phase 6.4 evaluation
```

Export runtime package.

---

# 276. Candidate Integration — Python Parity

Package commit only after Python native/ORT parity passes.

---

# 277. Candidate Integration — Rust Parity

Run Rust validator against exact runtime package.

Expected:

```text id="rt302"
PASS runtime validation record
```

---

# 278. Anomaly Integration — Registered Model

Same using actual tiny anomaly registered model/evaluation.

---

# 279. Anomaly Integration — Python Parity

Mandatory.

---

# 280. Anomaly Integration — Rust Parity

Mandatory.

---

# 281. RAW_DELETED Integration

Source training Gold may ultimately descend from:

```text id="rt303"
Bronze RAW_DELETED
```

Runtime export/parity still succeeds.

---

# 282. Zero Bronze Read Integration

Instrument all Phase 6.6 operations.

Expected:

```text id="rt304"
Bronze reads = 0
```

---

# 283. Zero Silver Read Integration

Expected:

```text id="rt305"
Silver reads = 0
```

---

# 284. ClickHouse Offline Integration

Stop ClickHouse.

Export + Rust parity succeed.

---

# 285. NATS Offline Integration

Stop NATS.

Export + Rust parity succeed.

---

# 286. External Network Offline Integration

Disable internet.

Export + parity succeed.

---

# 287. Go API Offline Integration

No effect.

---

# 288. Dashboard Offline Integration

No effect.

---

# 289. GPU Missing Integration

Mandatory CPU export/parity succeeds.

---

# 290. Optional CUDA Integration

If CUDA/ORT support is available locally:

```text id="rt306"
optional manual Rust CUDA validation
```

may produce a separate validation record.

It is not normal CI requirement.

---

# 291. Candidate Package Integrity Failure Test

Corrupt:

```text id="rt307"
model.onnx
```

Rust validation must fail before inference.

---

# 292. Preprocessing Integrity Failure Test

Corrupt preprocessing.

Rust rejects package.

---

# 293. Threshold Integrity Failure Test

Corrupt threshold.

Rust rejects package.

---

# 294. Parity Fixture Integrity Failure Test

Corrupt fixture.

Rust rejects package.

---

# 295. Runtime Manifest Integrity Failure Test

Invalid references/hashes fail.

---

# 296. Wrong Task Package Test

Candidate runtime interpreted as anomaly:

```text id="rt308"
reject
```

---

# 297. Wrong Model Version Test

Unknown model version:

```text id="rt309"
reject
```

---

# 298. Wrong Preprocessing Version Test

Reject.

---

# 299. Wrong Candidate Threshold Policy Test

Reject unsupported policy.

---

# 300. Wrong Anomaly Threshold Policy Test

Reject unsupported policy.

---

# 301. Wrong Candidate Score Definition Test

Reject unsupported semantics.

---

# 302. Wrong Anomaly Score Definition Test

Reject unsupported semantics.

---

# 303. Partial Runtime Package Test

No manifest:

```text id="rt310"
Rust must not load package
```

---

# 304. Runtime Manifest Last Test

Inject export failure before manifest.

Expected package not committed.

---

# 305. Manifest PUT Failure

ONNX/preprocessing/threshold/fixture may exist.

Without manifest:

```text id="rt311"
runtime package uncommitted
```

Rerun may verify/reuse exact objects.

---

# 306. Rust Validation Record Write Failure

Parity may have passed locally.

Without durable PASS record:

```text id="rt312"
package remains unqualified for Stage 7
```

Rerun validator.

---

# 307. Rust Validation FAIL Record

Intentionally perturb expected output.

Expected:

```text id="rt313"
FAIL validation record
```

and no deployment state change.

---

# 308. PASS + FAIL May Coexist Historically

For different:

```text id="rt314"
runtime versions

providers

validation policies
```

multiple immutable records may exist.

Stage 7 must select a compatible PASS record.

---

# 309. No Runtime Validation Checkpoint

Do NOT create:

```text id="rt315"
checkpoints/runtime-validation/
```

Validation is small and restartable.

---

# 310. No Inference Checkpoint

Still do NOT create:

```text id="rt316"
checkpoints/inference/
```

No production prediction processing exists yet.

---

# 311. No Prediction Objects

Do NOT write:

```text id="rt317"
predictions/
```

---

# 312. No Prediction Contract

Do NOT add:

```text id="rt318"
prediction-v1.md
```

yet.

---

# 313. No Prediction NATS Subject

Do NOT create:

```text id="rt319"
aurora.v1.prediction.*

aurora.v1.inference.*
```

yet.

---

# 314. No Rust Long-Running Prediction Consumer Work

Do not expand:

```text id="rt320"
nats.rs
```

into production inference in this phase.

---

# 315. No Go API Runtime Endpoint

Go API does not serve model predictions yet.

---

# 316. No Dashboard Runtime UI

React does not display prediction scores yet.

---

# 317. No Automatic Runtime Switch

Creating a PASS validation does not alter any production-current pointer.

---

# 318. No Champion Rollback On Runtime Failure Automatically

If champion runtime validation fails:

```text id="rt321"
surface failure
```

Do not automatically mutate the registry champion.

An operator may later rollback explicitly using Phase 6.5.

---

# 319. Runtime Qualification Documentation

Create:

```text id="rt322"
docs/MODEL_RUNTIME.md
```

---

# 320. MODEL_RUNTIME.md Contents

Document:

```text id="rt323"
native model vs runtime package

runtime package layout

model-runtime-v1

opset 17

external preprocessing

candidate runtime formula

anomaly runtime formula

threshold provenance

Python native/ORT parity

Rust ORT parity

runtime validation records

CPU mandatory / CUDA optional

registry champion != runtime deployment
```

---

# 321. Candidate Runtime Formula Documentation

Include exact:

```text id="rt324"
raw features
    ->
impute
    ->
standardize
    ->
float32
    ->
ONNX logit
    ->
stable sigmoid
    ->
evaluation threshold
```

---

# 322. Anomaly Runtime Formula Documentation

Include exact:

```text id="rt325"
raw features
    ->
impute
    ->
standardize
    ->
float32
    ->
ONNX reconstruction
    ->
reconstruction MSE
    ->
evaluation threshold
```

---

# 323. Document Score Meaning

Candidate:

```text id="rt326"
candidate-vetting classifier score
```

Anomaly:

```text id="rt327"
reconstruction-error evidence
```

Avoid scientific confirmation wording.

---

# 324. Update MODEL_REGISTRY.md

Add:

```text id="rt328"
registry champion
    !=
runtime-qualified ONNX package
```

and runtime package is derived.

---

# 325. Update ML_EVALUATION.md

Clarify:

```text id="rt329"
Phase 6.4 threshold is copied into runtime package
```

without being recomputed.

---

# 326. Update CHECKPOINTS.md

Confirm final Stage 6.6 hierarchy remains:

```text id="rt330"
checkpoints/
├── ingestion/
├── preprocessing/
├── feature-engineering/
├── ml-training/
└── lifecycle/
```

No inference checkpoint yet.

---

# 327. Update CONFIGURATION.md

Document only real runtime configuration such as:

```text id="rt331"
MinIO model/runtime location

Rust ONNX provider

optional CUDA selection

temporary model/cache path
```

Do not expose:

```text id="rt332"
feature order

threshold

preprocessing parameters
```

as environment configuration.

Those come from immutable runtime package.

---

# 328. Do Not Environment-Configure Threshold

No:

```text id="rt333"
AURORA_MODEL_THRESHOLD=...
```

for normal V1 runtime.

Use exact threshold artifact.

---

# 329. Do Not Environment-Configure Feature Order

No:

```text id="rt334"
AURORA_MODEL_FEATURES=...
```

Runtime package defines it.

---

# 330. Python README

Add:

```text id="rt335"
registered model
      |
      v
ONNX export
      |
      v
Python parity
      |
      v
immutable runtime package
      |
      v
Rust parity
```

---

# 331. Rust README

Update:

```text id="rt336"
apps/rust-inference/README.md
```

with:

```text id="rt337"
supported runtime schema

candidate/anomaly model versions

validate-runtime command

CPU provider

optional CUDA

feature ordering

preprocessing

threshold application
```

---

# 332. Contracts README

Add:

```text id="rt338"
model-runtime-v1

model-runtime-validation-v1
```

---

# 333. ARCH.MD

Only concise architecture change if needed:

```text id="rt339"
Python:
    native model -> ONNX runtime package

Rust:
    ONNX runtime validation/inference
```

Do not put tensor field details in ARCH.MD.

---

# 334. STRUCTURE.md

Reflect actual new files only.

Potential:

```text id="rt340"
contracts/data/model-runtime-v1.md

contracts/data/model-runtime-validation-v1.md

docs/MODEL_RUNTIME.md

apps/rust-inference/src/storage.rs
```

only if implemented.

---

# 335. Python Test File

Recommended:

```text id="rt341"
tests/test_export_onnx.py
```

Existing tests may be extended if ownership is already clear.

---

# 336. Rust Tests

Extend existing Rust inference tests or add focused:

```text id="rt342"
tests/runtime_test.rs
```

if current Rust test layout uses integration tests.

Do not create many tiny test modules unnecessarily.

---

# 337. Cross-Language E2E Script

Phase 6.6 justifies one focused script:

```text id="rt343"
tests/e2e/stage6-runtime-parity.sh
```

because the core requirement crosses:

```text id="rt344"
Python
+
MinIO
+
Rust
+
ONNX Runtime
```

---

# 338. E2E Script Scope

It should:

```text id="rt345"
resolve/build tiny registered candidate model

resolve candidate evaluation

export candidate runtime package

run Rust candidate parity

assert PASS validation

resolve/build tiny anomaly model

resolve anomaly evaluation

export anomaly runtime package

run Rust anomaly parity

assert PASS validation
```

It may reuse earlier Phase 6 fixtures rather than retrain large models.

---

# 339. No NATS In E2E Parity

Run Stage 6.6 parity successfully with NATS stopped.

---

# 340. Makefile Target

Add:

```text id="rt346"
make e2e-runtime-parity
```

or one equivalent explicit target.

---

# 341. CI Runtime

Use:

```text id="rt347"
tiny MLP

tiny autoencoder

small parity fixtures
```

No large training.

---

# 342. CI CPU Only

Mandatory parity CI should use CPU.

---

# 343. Rust Quality Gates

Run:

```text id="rt348"
cargo fmt --check

cargo clippy

cargo test
```

according to repository CI conventions.

---

# 344. Python Quality Gates

Run existing:

```text id="rt349"
tests

lint

type/static checks
```

where configured.

---

# 345. Runtime Package Size Sanity

Candidate/anomaly ONNX packages should remain small.

Do not introduce giant embedded scientific arrays.

---

# 346. 4 GB VRAM Constraint

Runtime models remain comfortably within:

```text id="rt350"
4 GB VRAM
```

GPU remains optional.

---

# 347. No Full LC Arrays In Runtime Package

Do not include:

```text id="rt351"
light-curve cadence arrays
```

---

# 348. No TPF Cubes In Runtime Package

Do not include:

```text id="rt352"
TPF pixel cubes
```

---

# 349. No FFI Frames In Runtime Package

Do not include giant image tensors.

---

# 350. Runtime Package Is Scalar-Feature Model Runtime

V1 input remains:

```text id="rt353"
fixed scalar feature vector
```

---

# 351. Runtime Provenance

For a runtime candidate package answer:

```text id="rt354"
Which trained model is this?
```

Trace:

```text id="rt355"
runtime package
      |
      v
registered model
      |
      v
training run
      |
      v
Gold snapshot
      |
      v
split
```

---

# 352. Runtime Threshold Provenance

Trace:

```text id="rt356"
runtime package
      |
      v
evaluation run
      |
      v
threshold.json
      |
      v
VALIDATION threshold selection
```

---

# 353. Runtime Evaluation Provenance

Also trace:

```text id="rt357"
evaluation run
      |
      +--> Golden cohort
      |
      +--> Recent cohort
```

where applicable.

---

# 354. Runtime Source Provenance Continues

From Gold:

```text id="rt358"
Gold
  |
  v
Silver
  |
  v
lineage
  |
  v
source product
```

even when Bronze is gone.

---

# 355. Runtime Validation Provenance

Must answer:

```text id="rt359"
Which Rust/ORT version validated this runtime package?
```

through:

```text id="rt360"
model-runtime-validation-v1
```

---

# 356. Phase 6.7 Handoff

Phase 6.7 should be able to assert:

```text id="rt361"
registry champion exists

runtime package exists for selected champion model/evaluation

Python ONNX parity PASS

Rust CPU parity PASS
```

before declaring Stage 6 complete.

---

# 357. Stage 7 Handoff

Stage 7 may later introduce:

```text id="rt362"
runtime deployment/current pointer

prediction request/event contract

prediction persistence

Go API serving

dashboard predictions
```

Those are NOT Phase 6.6 responsibilities.

---

# 358. Core Invariants

Invariant 1:

```text id="rt363"
ONNX is a derived runtime representation of an immutable registered model.
```

Invariant 2:

```text id="rt364"
Phase 6.5 native model packages are never mutated by ONNX export.
```

Invariant 3:

```text id="rt365"
Runtime package identity includes exact model, preprocessing, threshold and ONNX bytes.
```

Invariant 4:

```text id="rt366"
Feature order is explicit and identical in Python and Rust.
```

Invariant 5:

```text id="rt367"
Preprocessing stays outside ONNX in V1.
```

Invariant 6:

```text id="rt368"
Preprocessing parameters come only from TRAIN-fitted immutable artifacts.
```

Invariant 7:

```text id="rt369"
Runtime export never recomputes imputation/scaling parameters.
```

Invariant 8:

```text id="rt370"
Runtime export never recomputes decision thresholds.
```

Invariant 9:

```text id="rt371"
Candidate ONNX outputs logits.
```

Invariant 10:

```text id="rt372"
Candidate runtime score uses stable sigmoid.
```

Invariant 11:

```text id="rt373"
Candidate threshold uses score >= frozen evaluation threshold.
```

Invariant 12:

```text id="rt374"
Anomaly ONNX outputs reconstruction vectors.
```

Invariant 13:

```text id="rt375"
Anomaly runtime score is reconstruction-mse-v1 in standardized space.
```

Invariant 14:

```text id="rt376"
Anomaly alert uses score >= frozen validation p99 threshold.
```

Invariant 15:

```text id="rt377"
Candidate score is vetting evidence, not scientific planet confirmation.
```

Invariant 16:

```text id="rt378"
Anomaly reconstruction score is evidence, not calibrated anomaly probability.
```

Invariant 17:

```text id="rt379"
Committed runtime package already passed Python native-vs-ONNX parity.
```

Invariant 18:

```text id="rt380"
Rust runtime qualification is separate immutable evidence.
```

Invariant 19:

```text id="rt381"
Rust CPU parity is mandatory.
```

Invariant 20:

```text id="rt382"
CUDA parity is optional and never correctness-critical.
```

Invariant 21:

```text id="rt383"
Runtime validation performs exact feature/preprocessing/output/score/decision checks.
```

Invariant 22:

```text id="rt384"
A runtime package without Rust PASS validation is not Stage-7 deployment-qualified.
```

Invariant 23:

```text id="rt385"
Runtime package creation does not change registry champion.
```

Invariant 24:

```text id="rt386"
Runtime validation does not deploy a model.
```

Invariant 25:

```text id="rt387"
Phase 6.6 performs zero Bronze reads.
```

Invariant 26:

```text id="rt388"
Phase 6.6 performs zero Silver reads.
```

Invariant 27:

```text id="rt389"
NATS is not required for export/parity.
```

Invariant 28:

```text id="rt390"
ClickHouse is not required for export/parity.
```

Invariant 29:

```text id="rt391"
No prediction artifacts/events are introduced in Phase 6.6.
```

Invariant 30:

```text id="rt392"
No inference checkpoint exists before actual production prediction processing.
```

---

# Definition of Done

Phase 6.6 is COMPLETE when:

* [x] `model-runtime-v1.md` exists.
* [x] `model-runtime-validation-v1.md` exists.
* [x] `onnx-export-v1` is defined.
* [x] ONNX opset 17 is explicitly frozen.
* [x] PyTorch exporter behavior is explicitly selected rather than relying on changing defaults.
* [x] Python ONNX dependencies are declared.
* [x] Rust ONNX Runtime dependency is explicitly pinned/managed.
* [x] Runtime export accepts explicit model ID.
* [x] Runtime export accepts explicit evaluation-run ID.
* [x] Optional champion convenience resolves exact immutable IDs before export.
* [x] Runtime export verifies registered model manifest.
* [x] Runtime export verifies native model SHA.
* [x] Runtime export verifies preprocessing SHA.
* [x] Runtime export verifies evaluation manifest.
* [x] Runtime export verifies evaluation references the exact model/training artifacts.
* [x] Runtime export verifies threshold SHA.
* [x] Candidate runtime accepts only supported candidate model/preprocessing versions.
* [x] Anomaly runtime accepts only supported anomaly model/preprocessing versions.
* [x] Runtime export performs zero Bronze reads.
* [x] Runtime export performs zero Silver reads.
* [x] Runtime export requires no ClickHouse.
* [x] Runtime export requires no NATS.
* [x] Runtime export requires no external catalog network.
* [x] Runtime export works after source Bronze is `RAW_DELETED`.
* [x] Registered model package is never mutated.
* [x] Training run is never mutated.
* [x] Evaluation run is never mutated.
* [x] Gold is never mutated.
* [x] Split is never mutated.
* [x] Champion pointer is never mutated.
* [x] Runtime packages live under `models/runtime/`.
* [x] Candidate runtime package layout exists.
* [x] Anomaly runtime package layout exists.
* [x] Runtime package contains `model.onnx`.
* [x] Runtime package contains exact copied `preprocessing.json`.
* [x] Runtime preprocessing SHA equals registry preprocessing SHA.
* [x] Runtime package contains exact copied `threshold.json`.
* [x] Runtime threshold SHA equals evaluation threshold SHA.
* [x] Runtime package contains `parity-fixture.json`.
* [x] Runtime package contains manifest written last.
* [x] Manifest is runtime-package commit marker.
* [x] Partial runtime directory without manifest is not committed.
* [x] Runtime package is immutable after manifest commit.
* [x] Existing identical runtime package is reused idempotently.
* [x] Conflicting deterministic runtime package is rejected.
* [x] Runtime package does not contain mutable champion/deployed state.
* [x] No runtime-current pointer is introduced.
* [x] Runtime package identity is deterministic.
* [x] Runtime identity includes source model identity.
* [x] Runtime identity includes source model-manifest SHA.
* [x] Runtime identity includes source evaluation identity.
* [x] Runtime identity includes source evaluation-manifest SHA.
* [x] Runtime identity includes preprocessing SHA.
* [x] Runtime identity includes threshold SHA.
* [x] Runtime identity includes feature specs/order.
* [x] Runtime identity includes model/score semantics.
* [x] Runtime identity includes ONNX export version.
* [x] Runtime identity includes opset.
* [x] Runtime identity includes ONNX SHA.
* [x] Runtime identity includes parity-fixture SHA.
* [x] Runtime identity excludes timestamps.
* [x] Runtime identity excludes hostname/temp path.
* [x] Re-exporting exact same model/evaluation/export produces same runtime ID.
* [x] Same native model with a changed threshold produces a new runtime ID.
* [x] Changed ONNX bytes produce a new runtime ID.
* [x] Changed feature order produces a new runtime identity.
* [x] Changed opset/export semantics produce a new runtime identity.
* [x] Preprocessing remains outside ONNX.
* [x] Runtime manifest contains ordered feature names.
* [x] Runtime manifest contains typed feature specs.
* [x] Missing feature key is distinguishable from explicit null.
* [x] Unknown extra input feature is rejected in V1.
* [x] Numeric preprocessing uses float64 before float32 cast.
* [x] Null numeric values use exact TRAIN median.
* [x] Standardization uses exact TRAIN means/scales.
* [x] Boolean encoding matches frozen Python preprocessing when boolean inputs exist.
* [x] Nonfinite raw runtime values are rejected.
* [x] Final ONNX input vector contains no NaN/Inf.
* [x] Candidate ONNX input name is frozen.
* [x] Candidate ONNX input dtype is float32.
* [x] Candidate ONNX input rank/shape is frozen.
* [x] Candidate batch dimension is dynamic.
* [x] Candidate feature dimension is fixed.
* [x] Candidate ONNX output is raw logit.
* [x] Candidate output name/shape is frozen.
* [x] `candidate-sigmoid-score-v1` exists.
* [x] Candidate stable sigmoid implementation exists in Python.
* [x] Candidate stable sigmoid implementation exists in Rust.
* [x] Candidate runtime threshold is loaded from Phase 6.4 artifact.
* [x] Candidate runtime does not default to 0.5 unless artifact explicitly contains it.
* [x] Candidate threshold is validated in `[0,1]`.
* [x] Candidate `above_threshold` uses `>=`.
* [x] Candidate runtime does not call threshold crossing scientific confirmation.
* [x] Anomaly ONNX input name/dtype/shape is frozen.
* [x] Anomaly ONNX output is reconstruction vector.
* [x] Anomaly reconstruction output dimension equals input dimension.
* [x] Anomaly runtime reuses `reconstruction-mse-v1`.
* [x] Anomaly MSE is computed in standardized feature space.
* [x] Anomaly threshold is loaded from Phase 6.4 artifact.
* [x] Anomaly threshold is finite/nonnegative.
* [x] Anomaly `above_threshold` uses `>=`.
* [x] Anomaly runtime does not expose a fake probability.
* [x] Native model is reconstructed by model version + state dict.
* [x] Runtime export does not depend on whole-model pickle semantics.
* [x] Native model is set to evaluation mode before export.
* [x] Mandatory ONNX export occurs on CPU.
* [x] ONNX model passes structural checker.
* [x] ONNX graph input metadata is verified.
* [x] ONNX graph output metadata is verified.
* [x] Unexpected graph inputs are rejected.
* [x] Python ONNX Runtime uses CPU provider for mandatory parity.
* [x] `python-native-onnx-parity-v1` exists.
* [x] Python ONNX parity uses explicit tolerances.
* [x] Candidate native logits match Python ORT logits.
* [x] Candidate native/ORT sigmoid scores match.
* [x] Anomaly native reconstruction matches Python ORT reconstruction.
* [x] Anomaly native/ORT reconstruction MSE matches.
* [x] Python parity failure prevents runtime package commit.
* [x] Committed runtime manifest records Python parity PASS.
* [x] Parity fixture uses development VALIDATION rows rather than Golden Test.
* [x] Parity row selection is deterministic.
* [x] Parity base rows are sorted by source-product identity.
* [x] Parity base sample count is bounded.
* [x] No random parity sampling exists.
* [x] Parity fixture stores raw runtime feature values.
* [x] Parity fixture stores expected preprocessed float32 vectors.
* [x] Candidate fixture stores expected Python ORT logits.
* [x] Candidate fixture stores expected candidate scores.
* [x] Candidate fixture stores expected threshold booleans.
* [x] Anomaly fixture stores expected reconstruction vectors.
* [x] Anomaly fixture stores expected reconstruction scores.
* [x] Anomaly fixture stores expected threshold booleans.
* [x] Parity fixture stores no supervision labels unnecessarily.
* [x] Nullable runtime paths are represented by deterministic parity cases where applicable.
* [x] Synthetic null parity cases never mutate Gold.
* [x] Parity fixture SHA is recorded.
* [x] Rust runtime manifest parser is typed.
* [x] Rust runtime package integrity verification exists.
* [x] Rust verifies ONNX SHA before session creation.
* [x] Rust verifies preprocessing SHA.
* [x] Rust verifies threshold SHA.
* [x] Rust verifies parity fixture SHA.
* [x] Rust supports only explicit `model-runtime-v1`.
* [x] Rust supports only known candidate/anomaly model versions.
* [x] Rust supports only known preprocessing versions.
* [x] Rust supports exact candidate score semantics.
* [x] Rust supports exact anomaly score semantics.
* [x] Rust supports exact threshold-policy versions.
* [x] Rust runtime uses manifest feature order.
* [x] Rust does not rely on JSON/map iteration order.
* [x] Rust rejects missing features.
* [x] Rust rejects unknown extra features under V1 strict contract.
* [x] Rust null imputation matches Python.
* [x] Rust f64 preprocessing then float32 cast matches Python.
* [x] Rust boolean encoding matches Python where applicable.
* [x] Rust rejects nonfinite runtime input.
* [x] Rust verifies final input tensor finite.
* [x] Rust candidate stable sigmoid is numerically finite for extreme logits.
* [x] Rust candidate threshold equality behavior is correct.
* [x] Rust anomaly MSE exactness test passes.
* [x] Rust anomaly threshold equality behavior is correct.
* [x] Rust verifies candidate output shape.
* [x] Rust verifies anomaly output shape.
* [x] Rust rejects nonfinite ONNX output.
* [x] Rust CPU ONNX Runtime path works.
* [x] CUDA remains optional.
* [x] `provider=auto` may fall back to CPU.
* [x] Explicit unavailable CUDA request fails clearly.
* [x] Mandatory runtime qualification uses CPU.
* [x] Runtime models fit comfortably within 4 GB VRAM.
* [x] No GPU is required in CI.
* [x] `validate-runtime --runtime-package-id` or equivalent explicit Rust command exists.
* [x] Runtime validation command does not start long-running NATS inference.
* [x] Runtime validation works with NATS offline.
* [x] `rust-onnx-parity-v1` exists.
* [x] Rust preprocessing parity compares every fixture case.
* [x] Rust ONNX output parity compares every fixture case.
* [x] Candidate score parity compares every fixture case.
* [x] Anomaly score parity compares every fixture case.
* [x] Threshold decision parity is exact for every fixture case.
* [x] Runtime validation collects max preprocessing errors.
* [x] Runtime validation collects max ONNX output errors.
* [x] Runtime validation collects score error.
* [x] Runtime validation counts decision mismatches.
* [x] Runtime validation uses explicit parity tolerances.
* [x] Validation status is PASS only when every required check passes.
* [x] Preprocessing mismatch causes FAIL.
* [x] ONNX-output mismatch causes FAIL.
* [x] Score mismatch causes FAIL.
* [x] Decision mismatch causes FAIL.
* [x] Runtime validation records live under `models/runtime-validations/`.
* [x] Runtime validations are separate from immutable runtime packages.
* [x] `model-runtime-validation-v1` is implemented.
* [x] Runtime validation record references runtime package ID.
* [x] Runtime validation record references runtime manifest SHA.
* [x] Runtime validation record references parity fixture SHA.
* [x] Runtime validation record records provider.
* [x] Runtime validation record records Rust runtime version.
* [x] Runtime validation record records ONNX Runtime version.
* [x] Runtime validation record records tolerances.
* [x] Runtime validation record records error summaries.
* [x] Runtime validation record records PASS/FAIL.
* [x] Runtime validation fingerprint is deterministic.
* [x] Validation timestamp does not affect validation ID.
* [x] Same environment/package validation is idempotent.
* [x] Different relevant runtime version may create a new validation record.
* [x] Runtime validation records are immutable.
* [x] Validation record conflicts are rejected.
* [x] A runtime package without Rust PASS remains unqualified.
* [x] Rust validation does not mutate the runtime package.
* [x] Rust validation does not mutate champion pointer.
* [x] Rust validation does not create deployment state.
* [x] Candidate Python export unit tests pass.
* [x] Anomaly Python export unit tests pass.
* [x] ONNX input/output metadata tests pass.
* [x] ONNX checker failure test passes.
* [x] Candidate Python native/ORT parity test passes.
* [x] Anomaly Python native/ORT parity test passes.
* [x] Python parity failure test prevents commit.
* [x] Runtime fingerprint stability tests pass.
* [x] Runtime threshold-change identity test passes.
* [x] Runtime ONNX-change identity test passes.
* [x] Runtime feature-order identity test passes.
* [x] Runtime package idempotent-reuse test passes.
* [x] Runtime package conflict test passes.
* [x] Parity fixture deterministic selection test passes.
* [x] Parity fixture never uses Golden Test rows.
* [x] Nullable parity case test passes.
* [x] Runtime manifest serialization tests pass.
* [x] Runtime validation serialization tests pass.
* [x] Rust feature-order test passes.
* [x] Rust missing-feature test passes.
* [x] Rust extra-feature test passes.
* [x] Rust null-imputation test passes.
* [x] Rust standardization test passes.
* [x] Rust constant-scale test passes.
* [x] Rust boolean-encoding test passes where applicable.
* [x] Rust nonfinite-input test passes.
* [x] Stable sigmoid extreme-value tests pass.
* [x] Candidate score equality-threshold test passes.
* [x] Anomaly MSE exact test passes.
* [x] Anomaly score equality-threshold test passes.
* [x] ONNX input dimension mismatch test passes.
* [x] Candidate ONNX output shape mismatch test passes.
* [x] Anomaly reconstruction shape mismatch test passes.
* [x] Candidate cross-language preprocessing parity passes.
* [x] Candidate cross-language ONNX logit parity passes.
* [x] Candidate cross-language score parity passes.
* [x] Candidate cross-language decision parity passes.
* [x] Anomaly cross-language preprocessing parity passes.
* [x] Anomaly cross-language reconstruction parity passes.
* [x] Anomaly cross-language score parity passes.
* [x] Anomaly cross-language decision parity passes.
* [x] Candidate runtime integration uses a real tiny Phase 6.5 registered model.
* [x] Candidate runtime integration uses a real Phase 6.4 threshold.
* [x] Candidate runtime export commits.
* [x] Candidate Rust CPU validation writes PASS.
* [x] Anomaly runtime integration uses a real tiny Phase 6.5 registered model.
* [x] Anomaly runtime integration uses a real Phase 6.4 threshold.
* [x] Anomaly runtime export commits.
* [x] Anomaly Rust CPU validation writes PASS.
* [x] Runtime package corruption is detected.
* [x] ONNX corruption is detected.
* [x] Preprocessing corruption is detected.
* [x] Threshold corruption is detected.
* [x] Parity-fixture corruption is detected.
* [x] Wrong-task runtime package is rejected.
* [x] Unknown model/preprocessing/runtime schema is rejected.
* [x] Partial runtime package without manifest is rejected.
* [x] Runtime manifest-last failure behavior is safe.
* [x] Runtime validation-record write failure leaves package unqualified.
* [x] FAIL parity validation never alters deployment/champion state.
* [x] Runtime export/parity works after Bronze `RAW_DELETED`.
* [x] Entire Phase 6.6 performs zero Bronze reads.
* [x] Entire Phase 6.6 performs zero Silver reads.
* [x] ClickHouse-offline runtime parity test passes.
* [x] NATS-offline runtime parity test passes.
* [x] external-network-offline runtime parity test passes.
* [x] Go API offline has no effect.
* [x] Dashboard offline has no effect.
* [x] CPU-only runtime parity test passes.
* [x] Optional CUDA is not required for normal CI.
* [x] `tests/e2e/stage6-runtime-parity.sh` exists or equivalent cross-language E2E exists.
* [x] Candidate + anomaly parity are both covered by cross-language E2E.
* [x] Makefile has one explicit runtime-parity E2E target.
* [x] Rust fmt/clippy/tests pass.
* [x] Python tests/lint/type checks pass according to repository tooling.
* [x] No full LC arrays are placed in runtime package.
* [x] No TPF cubes are placed in runtime package.
* [x] No FFI frames are placed in runtime package.
* [x] Runtime V1 remains fixed-length scalar-feature inference.
* [x] Runtime package provenance traces to registered model.
* [x] Registered model traces to training run.
* [x] Training run traces to Gold + split.
* [x] Runtime threshold traces to exact Phase 6.4 evaluation.
* [x] Runtime validation records exact Rust/ORT qualification provenance.
* [x] No runtime-current pointer exists yet.
* [x] No `runtime_ready` mutable field exists in registry model manifest.
* [x] No `deployed` field is mutated in registry model.
* [x] No inference checkpoint exists.
* [x] No prediction object exists.
* [x] No prediction contract exists.
* [x] No prediction NATS event exists.
* [x] No long-running production prediction behavior is added.
* [x] No Go API inference endpoint is added.
* [x] No dashboard prediction UI is added.
* [x] No automatic deployment occurs.
* [x] No automatic champion rollback occurs on runtime failure.
* [x] `docs/MODEL_RUNTIME.md` exists.
* [x] `docs/MODEL_RUNTIME.md` documents native vs runtime model distinction.
* [x] `docs/MODEL_RUNTIME.md` documents opset 17.
* [x] `docs/MODEL_RUNTIME.md` documents preprocessing outside ONNX.
* [x] `docs/MODEL_RUNTIME.md` documents candidate runtime formula.
* [x] `docs/MODEL_RUNTIME.md` documents anomaly runtime formula.
* [x] `docs/MODEL_RUNTIME.md` documents Python parity.
* [x] `docs/MODEL_RUNTIME.md` documents Rust parity.
* [x] `docs/MODEL_RUNTIME.md` documents CPU mandatory/CUDA optional policy.
* [x] `docs/MODEL_RUNTIME.md` documents PASS runtime qualification semantics.
* [x] `docs/MODEL_REGISTRY.md` documents registry champion != runtime deployment.
* [x] `docs/ML_EVALUATION.md` documents threshold transfer into runtime package.
* [x] `docs/CHECKPOINTS.md` confirms no inference/runtime-validation checkpoint.
* [x] `docs/CONFIGURATION.md` documents only implemented runtime operational settings.
* [x] Threshold is not configured through mutable environment state.
* [x] Feature order is not configured through mutable environment state.
* [x] Python worker README documents ONNX export/runtime package flow.
* [x] Rust inference README documents supported runtime package/parity flow.
* [x] Contracts README documents runtime contracts.
* [x] ARCH.MD remains concise.
* [x] STRUCTURE.md reflects actual files.
* [x] Existing Stage 5 and Phase 6.1–6.5 tests remain green.
* [x] Repository is ready for Phase 6.7.

---

# Out of Scope

Do NOT implement in Phase 6.6:

* production prediction consumption
* inference NATS subjects
* prediction event schema
* prediction persistence
* inference checkpoints
* runtime deployment/current pointer
* automatic champion deployment
* model hot reload
* API inference endpoints
* dashboard candidate scores
* dashboard anomaly alerts
* large LC tensor inference
* TPF CNN inference
* FFI CNN inference
* full FFI GPU tensors
* ONNX preprocessing embedding
* automatic registry rollback
* automated retraining
* scientific exoplanet confirmation
* scientific anomaly confirmation

---

# Next

```text id="rt393"
Stage 6 — Machine Learning Training, Evaluation & Model Registry

Phase 6.1  ML Dataset View & Deterministic Group Split        [DONE]

Phase 6.2  Candidate Vetting Model Training                   [DONE]

Phase 6.3  Astronomical Anomaly Detection Training            [DONE]

Phase 6.4  Evaluation — Golden Test & Recent Holdout          [DONE]

Phase 6.5  Model Registry — Champion / Challenger,
           Promotion & Rollback                               [DONE]

Phase 6.6  ONNX Export & Rust Inference Parity                [DONE]

Phase 6.7  End-to-End ML Training & Model Validation
```

```
```
