# CHECKLIST_PHASE_1_1.md

# Stage 1 — Foundation & Infrastructure
## Phase 1.1 — Repository Foundation

Status: COMPLETE

Goal:

> Create the minimal AURORA monorepo foundation.
> Do not implement infrastructure or application logic yet.

---

## 1. Repository Root

- [x] Initialize Git repository.
- [x] Ensure default branch is `main`.
- [x] Create root directory structure.
- [x] Create root `README.md`.
- [x] Create root `ARCH.md`.
- [x] Create root `STRUCTURE.md`.
- [x] Create root `Makefile`.
- [x] Create `.gitignore`.
- [x] Create `.dockerignore`.
- [x] Create `.editorconfig`.
- [x] Create `.env.example`.

Expected root:

```text
aurora-cosmic/
├── README.md
├── ARCH.md
├── STRUCTURE.md
├── Makefile
├── .env.example
├── .gitignore
├── .dockerignore
└── .editorconfig
```

---

## 2. Monorepo Directories

Create only the top-level ownership boundaries.

* [x] Create `apps/`.
* [x] Create `contracts/`.
* [x] Create `config/`.
* [x] Create `infra/`.
* [x] Create `datasets/`.
* [x] Create `scripts/`.
* [x] Create `tests/`.
* [x] Create `docs/`.
* [x] Create `.github/`.
* [x] Create `.github/workflows/`.

Expected:

```text
aurora-cosmic/
│
├── apps/
├── contracts/
├── config/
├── infra/
├── datasets/
├── scripts/
├── tests/
├── docs/
└── .github/
    └── workflows/
```

Use `.gitkeep` only where required to preserve an empty directory.

---

## 3. Application Ownership Directories

Create service ownership boundaries only.

Do NOT initialize Go/Rust/Python projects yet.

* [x] Create `apps/go-ingester/`.
* [x] Create `apps/rust-preprocessor/`.
* [x] Create `apps/python-ml-worker/`.
* [x] Create `apps/rust-inference/`.
* [x] Create `apps/go-api/`.
* [x] Create `apps/dashboard/`.

Expected:

```text
apps/
├── go-ingester/
├── rust-preprocessor/
├── python-ml-worker/
├── rust-inference/
├── go-api/
└── dashboard/
```

Each application directory must remain isolated.

No application may contain code imported directly by another application.

---

## 4. Contracts Skeleton

Create contract ownership directories.

* [x] Create `contracts/events/`.
* [x] Create `contracts/data/`.
* [x] Create `contracts/README.md`.

Expected:

```text
contracts/
├── README.md
├── events/
└── data/
```

Do NOT define production schemas yet.

Contracts will contain shared data definitions only.

No shared business-logic library is allowed here.

---

## 5. Supporting Directory Skeleton

Create minimal subdirectories.

* [x] Create `datasets/examples/`.
* [x] Create `tests/fixtures/`.
* [x] Create `tests/e2e/`.

Expected:

```text
datasets/
└── examples/

tests/
├── fixtures/
└── e2e/
```

Do not add real FITS datasets.

Do not add generated Parquet data.

---

## 6. `.gitignore`

Ignore at minimum:

* [x] `.env`
* [x] `.env.*` except `.env.example`
* [x] IDE metadata.
* [x] OS metadata.
* [x] Python virtual environments.
* [x] Python cache files.
* [x] Python build artifacts.
* [x] Rust `target/`.
* [x] Go build binaries.
* [x] Coverage output.
* [x] Logs.
* [x] Temporary files.
* [x] Local MinIO data.
* [x] Local NATS data.
* [x] Local ClickHouse data.
* [x] Generated models.
* [x] Generated datasets.

Dataset extensions that must not be committed:

```text
*.fits
*.fits.gz
*.parquet
*.onnx
```

Allow small test fixtures only through an explicit future exception if required.

---

## 7. `.dockerignore`

Exclude unnecessary build context:

* [x] `.git/`
* [x] `.github/`
* [x] `.env`
* [x] IDE files.
* [x] local data directories.
* [x] generated datasets.
* [x] Rust `target/`.
* [x] Python caches.
* [x] local logs.
* [x] model artifacts.

Do not accidentally exclude source code or lock files.

---

## 8. `.editorconfig`

Define minimal repository-wide formatting:

* [x] UTF-8.
* [x] LF line endings.
* [x] final newline.
* [x] trim trailing whitespace.
* [x] default indentation.
* [x] Markdown trailing-space exception if required.
* [x] Makefile tab indentation.

Do not attempt to replace language-native formatters.

Go will use `gofmt`.

Rust will use `rustfmt`.

Python formatter will be configured later.

---

## 9. `.env.example`

Create placeholders only.

Do not commit real credentials.

Include sections for:

```text
AURORA_ENV=

MINIO_ENDPOINT=
MINIO_ACCESS_KEY=
MINIO_SECRET_KEY=
MINIO_BUCKET=

NATS_URL=

CLICKHOUSE_HOST=
CLICKHOUSE_PORT=

AURORA_BRONZE_MAX_BYTES=
AURORA_BRONZE_HIGH_WATERMARK=
AURORA_BRONZE_LOW_WATERMARK=

CUDA_VISIBLE_DEVICES=
```

Values should be development-safe examples or empty placeholders.

---

## 10. Root Makefile

Create a small orchestration Makefile.

Phase 1.1 only requires command placeholders.

Required targets:

* [x] `help`
* [x] `build`
* [x] `up`
* [x] `down`
* [x] `test`
* [x] `fmt`
* [x] `lint`
* [x] `clean`

`make help` must work immediately.

Other unfinished targets may print:

```text
Not implemented yet.
```

Do not implement Docker infrastructure in this phase.

Do not put application business logic inside the Makefile.

---

## 11. Root `README.md`

Keep it minimal.

Include only:

* [x] Project name.
* [x] One-paragraph project description.
* [x] Core technology list.
* [x] Link to `ARCH.md`.
* [x] Link to `STRUCTURE.md`.
* [x] Current development stage.

Example project identity:

```text
AURORA Cosmic Data Platform

Go       -> ingestion and API
Rust     -> preprocessing and inference
Python   -> analytics and ML
MinIO    -> data lake and durable checkpoints
NATS     -> event/control plane
```

Do not write individual service documentation yet.

---

## 12. `ARCH.md`

* [x] Add the already-approved core architecture document.
* [x] Preserve the architecture as the source of truth.
* [x] Do not expand implementation details here.

Core rule must remain:

```text
NATS remembers what still needs to happen.

MinIO checkpoints remember what has already happened.
```

---

## 13. `STRUCTURE.md`

* [x] Add the approved repository skeleton.
* [x] Document code-isolation principles.
* [x] Document application ownership boundaries.
* [x] Keep it consistent with the actual repository tree.

Core principles:

```text
small folders
explicit files
explicit data flow
minimal shared code
no generic helper layer
no cross-service imports
contracts over coupling
data flow over abstraction
```

---

## 14. Code Organization Rules

Repository must follow these rules from the beginning.

* [x] Do not create root `utils/`.
* [x] Do not create root `helpers/`.
* [x] Do not create root `common/`.
* [x] Do not create shared Go packages across services.
* [x] Do not create shared Rust crates yet.
* [x] Do not create shared Python utility packages yet.
* [x] Do not introduce unnecessary interfaces.
* [x] Do not introduce framework abstractions before real use cases exist.

Preferred naming:

```text
pipeline
stream
storage
checkpoint
consumer
model
runtime
```

Avoid generic names:

```text
manager
helper
utils
misc
common
```

unless the responsibility genuinely requires them.

---

## 15. Git Conventions

* [x] Create initial commit after repository foundation is valid.
* [x] Keep `main` buildable.
* [x] Use short-lived feature branches.
* [x] Keep commits scoped to one logical change.

Suggested branch naming:

```text
feature/<name>
fix/<name>
refactor/<name>
docs/<name>
```

Do not commit:

```text
secrets
raw FITS
generated Parquet
ONNX models
runtime volumes
local databases
```

---

## 16. Initial CI Placeholder

Create:

```text
.github/workflows/ci.yml
```

For Phase 1.1:

* [x] Valid GitHub Actions YAML.
* [x] Trigger on push to `main`.
* [x] Trigger on pull requests.
* [x] Run a repository structure check.
* [x] Run `make help`.

Do not configure language-specific builds yet.

Those belong to later phases after service initialization.

---

## 17. Repository Structure Validation

After Phase 1.1, repository should resemble:

```text
aurora-cosmic/
│
├── README.md
├── ARCH.md
├── STRUCTURE.md
├── Makefile
├── .env.example
├── .gitignore
├── .dockerignore
├── .editorconfig
│
├── apps/
│   ├── go-ingester/
│   ├── rust-preprocessor/
│   ├── python-ml-worker/
│   ├── rust-inference/
│   ├── go-api/
│   └── dashboard/
│
├── contracts/
│   ├── README.md
│   ├── events/
│   └── data/
│
├── config/
├── infra/
│
├── datasets/
│   └── examples/
│
├── scripts/
│
├── tests/
│   ├── fixtures/
│   └── e2e/
│
├── docs/
│
└── .github/
    └── workflows/
        └── ci.yml
```

---

## 18. Verification

The following commands must succeed:

```bash
git status
make help
```

Repository must contain no generated data.

Repository must contain no real credentials.

Repository must contain no application implementation yet.

Repository structure must match `STRUCTURE.md`.

---

# Definition of Done

Phase 1.1 is COMPLETE when:

* [x] Git repository is initialized.
* [x] Root project files exist.
* [x] Monorepo ownership directories exist.
* [x] Six application boundaries exist.
* [x] Contracts boundary exists.
* [x] Git/Docker ignore rules protect generated data and secrets.
* [x] `.env.example` exists without secrets.
* [x] Root Makefile works.
* [x] Minimal CI placeholder exists.
* [x] `ARCH.md` and `STRUCTURE.md` are committed.
* [x] No application logic has been implemented.
* [x] No infrastructure containers have been configured.
* [x] No unnecessary helper/common abstraction exists.
* [x] Repository is clean and ready for Phase 1.2.

---

# Out of Scope

Do NOT implement in Phase 1.1:

* Docker Compose services.
* MinIO configuration.
* NATS configuration.
* ClickHouse configuration.
* Go modules.
* Cargo projects.
* Python environments.
* FITS processing.
* NASA / MAST integration.
* Event schemas.
* Checkpoint implementation.
* ML models.
* GPU configuration.
* API endpoints.
* Dashboard.
* Observability stack.

These belong to later phases.

---

# Next

After this checklist passes:

```
Stage 1
    |
    +-- Phase 1.1 Repository Foundation       [DONE]
    |
    +-- Phase 1.2 Local Runtime Infrastructure
```
