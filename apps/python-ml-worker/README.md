# Python ML Worker Service

Dịch vụ **Python ML Worker** chịu trách nhiệm toàn bộ vòng đời học máy cho tác vụ phân loại ứng viên thiên thể (*Candidate Vetting*): từ xây dựng dataset views, chia tập dữ liệu chống rò rỉ (group-safe splits), huấn luyện mạng nơ-ron sâu (Deep ResMLP), đánh giá đa cohort (Golden & Recent), đến xuất xưởng gói mô hình ONNX Runtime và quản lý Model Registry (Promote/Rollback).

Dịch vụ vận hành **100% hướng sự kiện (event-driven) qua NATS**, **hoàn toàn không có thao tác CLI**.

---

## 1. Các Tầng Xử Lý (Processing Layers)

Kiến trúc dịch vụ được chia thành 4 tầng hạ tầng & điều phối riêng biệt:

```
┌──────────────────────────────────────────────────────────────────────────┐
│                   1. Control & Transport Layer (NATS)                    │
│    aurora.v1.ml.training.requested ──► Progress ──► Completed / Failed    │
│    aurora.v1.ml.training.control (Cancel / Checkpoint Signals)           │
├──────────────────────────────────────────────────────────────────────────┤
│             2. Storage Layer (MinIO + Ephemeral TempDir)                 │
│    MinIO bucket: aurora-ml-training (Durable Source of Truth)             │
│    Local Scratch: tempfile.TemporaryDirectory (Zero-Disk-Leak)           │
├──────────────────────────────────────────────────────────────────────────┤
│             3. ML Engine Layer (PyTorch & ONNX Runtime)                  │
│    Hardware Guard: VRAM Allocation Fraction & Device Resolution           │
│    Execution: PyTorch BCEWithLogitsLoss + Mixed Precision (AMP)          │
│    Inference Engine: ONNX Runtime Opset 17 with Parity Verification      │
├──────────────────────────────────────────────────────────────────────────┤
│                 4. Observability & Monitoring Layer                      │
│    Healthz HTTP Server (Port 8083) | Prometheus Metrics Exporter         │
│    Structured JSON Logging (Audit Trails & Training Lineage)             │
└──────────────────────────────────────────────────────────────────────────┘
```

### 1.1. Control & Transport Layer (NATS JetStream)
* **Giao thức điều phối**: Giao tiếp trực tiếp với Go API và Dashboard qua NATS.
* **Subjects**:
  - `aurora.v1.ml.training.requested`: Nhận yêu cầu huấn luyện mới (durable consumer).
  - `aurora.v1.ml.training.control`: Lắng nghe tín hiệu điều khiển thời gian thực (`checkpoint`, `cancel`).
  - `aurora.v1.ml.training.progress`: Phát tiến độ huấn luyện theo từng epoch.
  - `aurora.v1.ml.training.completed` / `aurora.v1.ml.training.failed`: Phát kết quả hoàn thành hoặc lỗi.

### 1.2. Storage & Persistence Layer (MinIO Object Store)
* **Durable Source of Truth**: Mọi artifact bền vững (trọng số `model.pt`, cấu hình `preprocessing.json`, manifests, evaluations, ONNX runtime packages) được lưu trữ trên MinIO bucket `aurora-ml-training`.
* **Zero Disk Leakage**: Quá trình huấn luyện sử dụng thư mục tạm thời `tempfile.TemporaryDirectory()`. Sau khi upload artifact lên MinIO thành công, thư mục tạm bị hủy ngay lập tức; tuyệt đối không ghi file rác ra đĩa máy chủ (`/evaluations`, `/checkpoints`).

### 1.3. ML Engine Layer (PyTorch & ONNX Runtime)
* **Device Resolution & VRAM Quota**: Tự động phát hiện CUDA hoặc CPU. Với GPU, thiết lập hạn mức `torch.cuda.set_per_process_memory_fraction` để bảo vệ tài nguyên hệ thống.
* **Deterministic Training**: Cố định seed cho PyTorch, CuDNN, NumPy và Python random.
* **ONNX Opset 17**: Chuyển đổi mô hình PyTorch sang ONNX với dynamic axes cho batch size và kiểm tra sai số parity logits (`max_abs_diff < 1e-4`).

### 1.4. Observability & Monitoring Layer
* Cung cấp endpoint HTTP `/healthz` (lắng nghe trên cổng 8083) và Prometheus metrics exporter.
* Hệ thống ghi log dạng Structured JSON phục vụ truy vết lỗi và audit lineage.

---

## 2. Các Phase Xử Lý trong Vòng Đời ML (Lifecycle Phases)

Toàn bộ quy trình ML được module hóa chặt chẽ thành 3 giai đoạn độc lập:

```
┌─────────────────┐       ┌─────────────────┐       ┌──────────────────┐
│  Phase 1:       │  ──►  │  Phase 2:       │  ──►  │  Phase 3:        │
│  PRE-TRAIN      │       │  TRAIN          │       │  POST-TRAIN      │
│  (Data, Splits, │       │  (Architecture, │       │  (Evaluation,    │
│   Preprocessor) │       │   Loop, MinIO)  │       │   ONNX, Registry)│
└─────────────────┘       └─────────────────┘       └──────────────────┘
```

### Phase 1: Pre-Train (`pre_train/`)
Chuẩn bị dữ liệu đầu vào sạch, chống rò rỉ nhãn và tính toán thống kê tiền xử lý:
1. **Dataset Views ([view.py](pre_train/view.py))**:
   - Lọc chính xác 31 thuộc tính `MODEL_INPUT` cố định.
   - Loại trừ triệt để các cột rò rỉ tương lai (`LEAKAGE_EXCLUSIONS` như human labels, vetting status).
   - Tạo SHA-256 fingerprint bất biến cho dataset view.
2. **Group-Safe Splits ([splits.py](pre_train/splits.py))**:
   - Phân chia tập Train/Val/Test theo `object_id` (deterministic hashing).
   - Đảm bảo tất cả các quan sát của cùng một thiên thể chỉ thuộc về duy nhất một tập (tránh data leakage do temporal correlation).
   - Lưu trữ `split_manifest.json` bất biến lên MinIO.
3. **Feature Preprocessor ([preprocessor.py](pre_train/preprocessor.py))**:
   - `fit(train_rows)`: Tính toán Median, Mean, Scale (Std) **duy nhất trên tập TRAIN**.
   - `transform_features(rows)`: Điền giá trị thiếu (NaN, Inf) bằng train median và chuẩn hóa Z-score.
   - `transform_labels(rows)`: Mã hóa nhãn `NEGATIVE` -> 0, `POSITIVE` -> 1.
   - Đóng gói cấu hình tiền xử lý thành `preprocessing.json`.

---

### Phase 2: Train (`train/`)
Khởi tạo phần cứng, mạng nơ-ron và điều phối vòng lặp huấn luyện:
1. **Device Resolution ([device.py](train/device.py))**:
   - Phân giải target `cpu` hoặc `cuda`.
   - Giới hạn bộ nhớ VRAM và kích hoạt AMP (Automatic Mixed Precision).
2. **Mô hình Mạng Nơ-ron ([model.py](train/model.py))**:
   - Mạng `CandidateTabularMLP` (Deep Residual Network kết hợp Feature Attention):
     + `input_proj`: Chiếu 31 features lên không gian 128 chiều (`Linear` + `LayerNorm` + `GELU`).
     + `res_block1`: Khối Residual mở rộng 256 chiều với skip connection.
     + `attn_gate`: Feature Attention Gate (Squeeze-and-Excitation) học tương quan giữa các đặc trưng.
     + `res_block2`: Khối Residual tinh chỉnh về 64 chiều.
     + `head`: Phân loại nhị phân ra **raw logits** (ổn định số học tối đa khi đi qua `BCEWithLogitsLoss`).
3. **Manifest & Checkpoint Contracts ([manifest.py](train/manifest.py))**:
   - `TrainingRunSpec`: Cấu hình siêu tham số (learning rate, batch size, patience).
   - `TrainingRunCheckpoint`: Lưu trạng thái epoch để phục hồi khi có sự cố.
   - `TrainingRunManifest`: Bản kê khai bất biến tổng hợp toàn bộ kết quả sau huấn luyện.
4. **Vòng lặp Huấn luyện ([loop.py](train/loop.py))**:
   - Tối ưu hóa bằng AdamW kết hợp bộ điều chỉnh tốc độ học CosineAnnealingLR.
   - Early stopping dựa trên validation loss.
   - Hỗ trợ hooks nhận tín hiệu can thiệp thời gian thực từ NATS (`checkpoint`, `cancel`).
   - Tính toán đầy đủ metrics: PR-AUC, ROC-AUC, F1, Precision, Recall.
5. **Workflow Orchestration ([workflow.py](train/workflow.py))**:
   - Tải Gold snapshot từ MinIO vào thư mục tạm `tempfile.TemporaryDirectory()`.
   - Thực thi training loop, đóng gói artifacts và upload lên MinIO bucket `aurora-ml-training`.
   - Tự động dọn dẹp sạch đĩa sau khi hoàn tất.

---

### Phase 3: Post-Train (`post_train/`)
Đánh giá độ tin cậy của mô hình qua nhiều cohort, xuất định dạng suy luận và quản lý phiên bản:
1. **Candidate Evaluation ([post_train/evaluate/](post_train/evaluate/))**:
   - **[threshold.py](post_train/evaluate/threshold.py)**: Quét ngưỡng xác suất quyết định tối ưu F1-score trên tập validation (`0.05 -> 0.95`).
   - **[cohort.py](post_train/evaluate/cohort.py)**: Trích xuất các tập đánh giá độc lập (Golden Cohort đã được xác thực bởi chuyên gia & Recent Cohort từ các quan sát gần nhất), kiểm tra chống ô nhiễm dữ liệu (`check_group_contamination`).
   - **[engine.py](post_train/evaluate/engine.py)**: Thực thi đánh giá độc lập, đối chiếu metrics trên các cohort và sinh `EvaluationRunManifest`.
2. **Export & Model Registry ([post_train/export/](post_train/export/))**:
   - **[onnx.py](post_train/export/onnx.py)**: Xuất mô hình PyTorch sang chuẩn **ONNX opset 17** với dynamic batch size, thực thi kiểm thử suy luận song song giữa PyTorch CPU và ONNX Runtime CPU để chứng minh độ sai lệch logits tuyệt đối `< 1e-4`.
   - **[registry.py](post_train/export/registry.py)**: Quản lý kho lưu trữ mô hình:
     + Lưu trữ model package đã cam kết (`manifest.json`, `model.pt`, `preprocessing.json`).
     + Đánh giá thăng hạng mô hình (Promotion Policy): So sánh Challenger vs Champion dựa trên tiêu chí Golden PR-AUC.
     + Hỗ trợ Rollback về Champion trước đó kèm theo nhật ký kiểm toán (audit log) đầy đủ.

---

## 3. Sơ đồ Cấu trúc Thư mục (Directory Layout)

```
apps/python-ml-worker/
├── config.py               # Cấu hình hạ tầng (MinIO, NATS, Metrics)
├── logger.py               # Structured JSON logger chuẩn
├── metrics.py              # Prometheus metrics & HTTP /healthz server
├── store.py                # MinIO object store client & TrainingStore
│
├── pre_train/              # [Phase 1] Dữ liệu, Group-Safe Splits & Tiền xử lý
│   ├── view.py             # Feature definitions, schemas & fingerprinting
│   ├── splits.py           # Deterministic group splitting & split manifest
│   ├── preprocessor.py     # CandidatePreprocessor (imputation, z-score transform)
│   └── __init__.py         # Re-exported pre-training APIs
│
├── train/                  # [Phase 2] Mô hình, Checkpoints & Huấn luyện PyTorch
│   ├── model.py            # CandidateTabularMLP, ResidualDenseBlock, FeatureAttentionGate
│   ├── manifest.py         # TrainingRunSpec, TrainingRunManifest, TrainingRunCheckpoint
│   ├── device.py           # Device resolution (CPU/GPU) & VRAM allocation quota
│   ├── loop.py             # PyTorch training loop, CosineAnnealing, early stopping & metrics
│   ├── workflow.py         # End-to-end orchestration, ephemeral storage & MinIO packaging
│   └── __init__.py         # Re-exported training APIs
│
├── post_train/             # [Phase 3] Đánh giá Đa Cohort, ONNX Export & Model Registry
│   ├── evaluate/           # Đánh giá đa cohort & quét ngưỡng
│   │   ├── threshold.py    # Threshold selection & cohort metric calculations
│   │   ├── cohort.py       # Golden & Recent cohort extraction with leakage checks
│   │   ├── engine.py       # Deterministic evaluation run orchestration & manifests
│   │   └── __init__.py     # Re-exported evaluation APIs
│   ├── export/             # Đóng gói ONNX & Quản lý phiên bản Registry
│   │   ├── onnx.py         # ONNX opset 17 export, validation & parity verification
│   │   ├── registry.py     # Model registry, promotion policies & rollback management
│   │   └── __init__.py     # Re-exported export APIs
│   └── __init__.py         # Re-exported post-training APIs
│
├── benches/                # [Telemetry] Bộ đo lường Benchmark cho CPU, Memory & GPU (PyTorch/NVML)
│   ├── profiler.py         # Đo lường Host Heap, OS context switches, VRAM & NVML Core Util/Temp
│   ├── generator.py        # Sinh dữ liệu giả lập thiên văn (31 features) & mô hình in-memory
│   ├── runner.py           # CLI runner & định dạng bảng báo cáo phần cứng
│   └── scenarios/          # Các kịch bản đo kiểm chi tiết
│       ├── preprocess.py   # Đo lường Stage 1 ETL, Split & Preprocessor
│       ├── training.py     # Đo lường Stage 2 PyTorch Training (CUDA AMP vs CPU FP32)
│       ├── onnx_inference.py # Đo lường ONNX Runtime vs PyTorch & kiểm tra sai số số học
│       └── evaluation.py   # Đo lường Stage 3 Multi-cohort build, Leakage & Threshold sweep
│
├── service.py              # Service entrypoint, NATS JetStream consumer & control subscriber
├── Dockerfile              # Container build
└── pyproject.toml          # Quản lý dependencies (hatchling, torch, onnx, minio, nats-py)
```

---

## 4. Kiểm Thử, Benchmark & Vận Hành

Chạy bộ kiểm thử toàn diện:
```bash
uv run --project apps/python-ml-worker --extra dev pytest apps/python-ml-worker/tests
```

Kiểm tra định dạng và chất lượng mã nguồn:
```bash
uv run --project apps/python-ml-worker --extra dev ruff check apps/python-ml-worker
```

Chạy bộ đo lường Benchmark phần cứng (CPU, Host RAM, PyTorch VRAM & NVIDIA GPU Telemetry):
```bash
uv run --project apps/python-ml-worker python -m benches.runner
```

Kiểm tra trạng thái dịch vụ native systemd:
```bash
systemctl --user status aurora-python-ml-worker.service
curl -s http://127.0.0.1:8083/healthz
```
