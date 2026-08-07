# STAGE.MD — Project Execution Roadmap

Tài liệu quy định lộ trình phát triển của **AURORA Cosmic Data Platform**, được chia thành **8 Stage** và **42 Phase** tuân thủ chặt chẽ theo **Data Flow Isolation** và **Dependency Matrix**.

---

## 🗺️ Data Flow & Dependency Matrix

```text
STAGE 1: Foundation & Infrastructure
   │
   ▼
STAGE 2: Data Source & Go Ingestion (NASA MAST -> Go -> MinIO Bronze + NATS)
   │
   ▼
STAGE 3: Rust Preprocessing Pipeline (NATS -> Rust -> MinIO Silver)
   │
   ▼
STAGE 4: Checkpoint, Recovery & Rolling Lifecycle (Idempotency + Rolling ~50 GiB)
   │
   ▼
STAGE 5: Gold Dataset & Scientific Analytics (Silver -> Gold Parquet + Catalogs/Labels)
   │
   ▼
STAGE 6: ML Platform & Model Evolution (Gold -> Python ML -> ONNX Model Registry)
   │
   ▼
STAGE 7: Rust Inference, Go API & Dashboard (ONNX -> Rust Inference -> Go API -> Dashboard)
   │
   ▼
STAGE 8: Observability, Benchmark & System Hardening (Prometheus/Grafana -> Stress Test -> Hardening)
```

> ⚠️ **Quy tắc phụ thuộc cứng (Hard Dependency):**
> 1. Không làm **ML (Stage 6)** trước khi **Preprocessing & Gold Dataset (Stage 3–5)** hoàn tất và ổn định.
> 2. Không xây dựng **Dashboard (Stage 7.5)** trước khi **Go API & Rust Inference (Stage 7.1–7.4)** có API contract rõ ràng.

---

## 📊 Summary Overview

| Stage | Tên Stage | Số Phase | Output Chính |
| :--- | :--- | :---: | :--- |
| **Stage 1** | Foundation & Infrastructure | 5 | Monorepo skeleton, Docker Compose runtime, Makefile, Service stubs |
| **Stage 2** | Data Source & Go Ingestion | 5 | Ingestion FITS stream sang MinIO Bronze, NATS ingestion events |
| **Stage 3** | Rust Preprocessing Pipeline | 5 | Rust FITS parser, Tokio workers, MinIO Silver Parquet datasets |
| **Stage 4** | Checkpoint, Recovery & Rolling Lifecycle | 5 | State checkpoints, idempotency, rolling Bronze window ~50 GiB |
| **Stage 5** | Gold Dataset & Scientific Analytics | 5 | Feature engineering, catalog/labels integration, Gold snapshots |
| **Stage 6** | ML Platform & Model Evolution | 6 | Candidate & anomaly models, ONNX export, Champion/Challenger |
| **Stage 7** | Rust Inference, Go API & Dashboard | 5 | Rust ONNX serving, Go Query API, Interactive Scientific Dashboard |
| **Stage 8** | Observability, Benchmark & Hardening | 6 | Prometheus/Grafana metrics, system benchmarks, end-to-end resilience |
| **Tổng** | **8 Stages** | **42 Phases** | **Full Production-Grade Data & ML Pipeline** |

---

## 🛠️ Chi Tiết Các Stage & Phase

### Stage 1 — Foundation & Infrastructure

Mục tiêu: Dựng toàn bộ skeleton monorepo, Docker Compose runtime, `.env`, MinIO, NATS JetStream, ClickHouse và các service placeholder. Infrastructure sẵn sàng `make up` và healthcheck thành công.

```text
Stage 1
├── Phase 1.1: Repository Foundation
├── Phase 1.2: Local Runtime Infrastructure
├── Phase 1.3: Service Skeleton
├── Phase 1.4: Configuration & Environment
└── Phase 1.5: Development Workflow
```

* **Phase 1.1 — Repository Foundation**: Khởi tạo monorepo, cấu trúc thư mục tiêu chuẩn, Git configuration, root Makefile và conventions chung.
* **Phase 1.2 — Local Runtime Infrastructure**: Dựng MinIO, NATS JetStream, ClickHouse bằng Docker Compose với healthchecks.
* **Phase 1.3 — Service Skeleton**: Tạo skeleton cho Go Ingester, Rust Preprocessor, Python ML Worker, Rust Inference, Go API và Dashboard.
* **Phase 1.4 — Configuration & Environment**: Chuẩn hóa `.env.example`, central config files, ports, MinIO buckets (`bronze`, `silver`, `gold`, `models`), NATS subjects.
* **Phase 1.5 — Development Workflow**: Chuẩn hóa lệnh `make build`, `make up`, `make down`, `make lint`, `make test` và smoke test script.

---

### Stage 2 — Data Source & Go Ingestion

Mục tiêu: Kết nối NASA MAST, discover TESS products, stream FITS trực tiếp vào MinIO Bronze mà không phình RAM, phát event qua NATS.

```text
Stage 2
├── Phase 2.1: TESS / MAST Source Discovery
├── Phase 2.2: Product Selection & Manifest
├── Phase 2.3: FITS Streaming Ingestion
├── Phase 2.4: Bronze Object Layout
└── Phase 2.5: Ingestion Event Publishing
```

* **Phase 2.1 — TESS / MAST Source Discovery**: Kết nối MAST API, query TPF (Target Pixel File), Light Curve và FFI products.
* **Phase 2.2 — Product Selection & Manifest**: Định nghĩa manifest cho data download (TIC ID, Sector, Camera, CCD, File size, Hash checksum).
* **Phase 2.3 — FITS Streaming Ingestion**: Go Ingester stream HTTP FITS file trực tiếp vào MinIO Bronze qua `io.Reader`, kiểm soát memory footprint.
* **Phase 2.4 — Bronze Object Layout**: Chuẩn hóa đường dẫn object trong MinIO Bronze: `bronze/tess/year/sector/tic_id/filename.fits`.
* **Phase 2.5 — Ingestion Event Publishing**: Go Ingester publish lightweight JSON event `bronze-object-ready` sang NATS JetStream khi upload xong.

---

### Stage 3 — Rust Preprocessing Pipeline

Mục tiêu: Rust consume event từ NATS, đọc FITS từ Bronze, xử lý đa luồng qua Tokio tasks và ghi kết quả Silver Parquet vào MinIO.

```text
Stage 3
├── Phase 3.1: NATS Consumer Runtime
├── Phase 3.2: FITS Reading Layer
├── Phase 3.3: Light Curve Preprocessing
├── Phase 3.4: Image / TPF Preprocessing
└── Phase 3.5: Silver Materialization
```

* **Phase 3.1 — NATS Consumer Runtime**: Rust worker subscribe NATS JetStream, quản lý bounded concurrency với Tokio worker pool.
* **Phase 3.2 — FITS Reading Layer**: Đọc FITS headers, primary HDUs, binary table extensions (Light Curve) và image arrays (TPF/FFI).
* **Phase 3.3 — Light Curve Preprocessing**: Xử lý quality flags, bỏ giá trị NaN/NULL, detrending, normalization và outlier rejection.
* **Phase 3.4 — Image / TPF Preprocessing**: Calibrate pixel intensities, background subtraction, aperture mask calculation, centroid tracking.
* **Phase 3.5 — Silver Materialization**: Ghi output chuẩn hóa dạng Parquet schema sang MinIO Silver và publish event `preprocess-completed`.

---

### Stage 4 — Checkpoint, Recovery & Rolling Lifecycle

Mục tiêu: Đảm bảo khả năng phục hồi lỗi (fault-tolerance), chống trùng lặp dữ liệu (idempotency) và duy trì dung lượng storage Bronze quanh mức budget ~50 GiB.

```text
Stage 4
├── Phase 4.1: Ingestion Checkpoint
├── Phase 4.2: Preprocessing Checkpoint
├── Phase 4.3: Idempotency & Redelivery
├── Phase 4.4: Raw Data Lifecycle
└── Phase 4.5: Rolling Storage Window
```

* **Phase 4.1 — Ingestion Checkpoint**: Lưu trạng thái tiến độ ingest của Go (manifest progress, byte offset, downloaded status) vào Key-Value store / DB.
* **Phase 4.2 — Preprocessing Checkpoint**: Lưu checkpoint trạng thái xử lý của Rust (source object hash, processing state, output parquet status).
* **Phase 4.3 — Idempotency & Redelivery**: Đảm bảo NATS message redelivery hoặc service restart không gây sinh dữ liệu trùng lặp ở MinIO/DB.
* **Phase 4.4 — Raw Data Lifecycle**: Tự động gắn tag và chuyển đổi trạng thái FITS thành `EVICTABLE` khi Silver Parquet đã được xác minh.
* **Phase 4.5 — Rolling Storage Window**: Triển khai cơ chế Watermark (High/Low) tự động thu dọn raw FITS trong Bronze để duy trì tổng dung lượng ~50 GiB.

---

### Stage 5 — Gold Dataset & Scientific Analytics

Mục tiêu: Từ Silver Parquet, kết hợp thông tin NASA Catalogs (TIC, TOI, TCE labels), tính toán đặc trưng khoa học và đóng gói Gold Dataset.

```text
Stage 5
├── Phase 5.1: Catalog & Label Integration
├── Phase 5.2: Scientific Feature Engineering
├── Phase 5.3: Transit Feature Pipeline
├── Phase 5.4: Anomaly / Variability Features
└── Phase 5.5: Gold Dataset Snapshots
```

* **Phase 5.1 — Catalog & Label Integration**: Tích hợp NASA Exoplanet Archive labels (TOI, TCE, Confirmed Planet, False Positive) và TIC stellar metadata.
* **Phase 5.2 — Scientific Feature Engineering**: Trích xuất đặc trưng thống kê time-series (kurtosis, skewness, variability indices, harmonic power).
* **Phase 5.3 — Transit Feature Pipeline**: Tính toán đặc trưng chu kỳ quá cảnh (BLS/TLS periodogram features, transit depth, duration, SNR, V-shape metric).
* **Phase 5.4 — Anomaly / Variability Features**: Tính toán đặc trưng cho việc phát hiện sao biến đổi và hiện tượng quang học bất thường.
* **Phase 5.5 — Gold Dataset Snapshots**: Đóng gói Gold Data theo version snapshot (`gold/v1/...`) hỗ trợ việc train ML đạt tính tái lập (reproducibility).

---

### Stage 6 — ML Platform & Model Evolution

Mục tiêu: Python ML Worker huấn luyện/đánh giá mô hình phát hiện planet candidates và bất thường, xuất ONNX và quản lý phiên bản model.

```text
Stage 6
├── Phase 6.1: ML Dataset Loader
├── Phase 6.2: Baseline Exoplanet Model
├── Phase 6.3: Anomaly Detection Model
├── Phase 6.4: GPU Training Path
├── Phase 6.5: Evaluation & Model Registry
└── Phase 6.6: Champion / Challenger
```

* **Phase 6.1 — ML Dataset Loader**: Python ML Worker đọc Gold Parquet snapshots, thực hiện train/validation/test split chuẩn khoa học.
* **Phase 6.2 — Baseline Exoplanet Model**: Xây dựng mô hình phân loại Exoplanet Candidate vs. False Positive (XGBoost/LightGBM và 1D-CNN baseline).
* **Phase 6.3 — Anomaly Detection Model**: Xây dựng mô hình Anomaly Detection (Autoencoder / Isolation Forest / Unsupervised metric learning).
* **Phase 6.4 — GPU Training Path**: Tối ưu hóa pipeline huấn luyện tận dụng NVIDIA GPU (4 GB VRAM budget).
* **Phase 6.5 — Evaluation & Model Registry**: Đánh giá chỉ số (ROC-AUC, Precision-Recall), xuất định dạng ONNX và đăng ký version vào MinIO Model Registry.
* **Phase 6.6 — Champion / Challenger**: Đổi mới model bằng cơ chế Champion/Challenger evaluation policy trước khi promote model mới lên Production.

---

### Stage 7 — Rust Inference, Go API & Dashboard

Mục tiêu: Rust nạp ONNX model thực thi inference siêu nhanh; Go API phục vụ dữ liệu query; Dashboard trực quan hóa cho nhà khoa học.

```text
Stage 7
├── Phase 7.1: Rust ONNX Runtime
├── Phase 7.2: Model Loading & Hot Swap
├── Phase 7.3: Prediction Pipeline
├── Phase 7.4: Go Query API
└── Phase 7.5: Scientific Dashboard
```

* **Phase 7.1 — Rust ONNX Runtime**: Tích hợp ONNX Runtime (`ort` crate) trong Rust để phục vụ dự đoán high-performance.
* **Phase 7.2 — Model Loading & Hot Swap**: Tự động nhận event promotion, nạp ONNX model mới từ MinIO vào memory mà không gián đoạn dịch vụ.
* **Phase 7.3 — Prediction Pipeline**: Phục vụ luồng dự đoán (Exoplanet Probability, Anomaly Score, Evidence feature attribution).
* **Phase 7.4 — Go Query API**: REST/gRPC API cung cấp truy vấn Targets, Light Curves, Candidates, Anomalies, Predictions và System Health.
* **Phase 7.5 — Scientific Dashboard**: Giao diện trực quan hóa tương tác (Light curve viewer, TPF pixel heatmaps, candidate score ranking, model diagnostics).

---

### Stage 8 — Observability, Benchmark & System Hardening

Mục tiêu: Giám sát toàn diện hệ thống với Prometheus/Grafana, đo đạc hiệu năng (benchmarks), thử nghiệm chịu lỗi và kiểm chứng vận hành liên tục.

```text
Stage 8
├── Phase 8.1: Metrics & Monitoring
├── Phase 8.2: Ingestion Benchmark
├── Phase 8.3: Preprocessing Benchmark
├── Phase 8.4: ML / Inference Benchmark
├── Phase 8.5: Failure & Recovery Testing
└── Phase 8.6: Long-Running System Validation
```

* **Phase 8.1 — Metrics & Monitoring**: Triển khai Prometheus metrics & Grafana dashboards cho Go, Rust, Python, MinIO, NATS và GPU.
* **Phase 8.2 — Ingestion Benchmark**: Đo đạc băng thông mạng, tốc độ stream ghi MinIO, CPU/Memory footprint của Go Ingester.
* **Phase 8.3 — Preprocessing Benchmark**: Đo throughput FITS parsing, mức độ song song Tokio worker pool, hiệu năng ghi Parquet của Rust Preprocessor.
* **Phase 8.4 — ML / Inference Benchmark**: Đo thời gian huấn luyện, VRAM GPU tiêu thụ, latency và throughput của Rust Inference engine (CPU vs GPU).
* **Phase 8.5 — Failure & Recovery Testing**: Thực hiện chaos testing (kill container, ngắt NATS connection, MinIO disk full, simulated crashes) để kiểm tra cơ chế recovery & idempotency.
* **Phase 8.6 — Long-Running System Validation**: Chạy liên tục hệ thống qua nhiều chu kỳ rolling storage (~50 GiB window) chứng minh tổng lượng data xử lý qua thời gian vượt xa giới hạn đĩa cứng.

---

## 📌 Nguyên Tắc Tổ Chức & Thực Thi

1. **Phase-by-Phase Execution**: Mỗi Phase chỉ được đánh giá hoàn thành khi đạt đủ điều kiện test case và code được format/lint sạch đẽ (`make fmt lint test`).
2. **Data Isolation Strictness**: Không dịch chuyển logic xử lý FITS/Preprocessing sang Go Ingester, không đặt logic huấn luyện ML vào Rust Preprocessor, không đặt logic API vào ML worker.
3. **Reproducibility**: Mọi artifact (FITS ingest manifest, Silver Parquet, Gold Snapshot, ONNX Model) đều phải có versioning rõ ràng trên MinIO.
