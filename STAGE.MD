# STAGE.MD — Project Execution Roadmap

Tài liệu quy định lộ trình phát triển của **AURORA Cosmic Data Platform**, được chia thành **8 Stage** và **42 Phase** tuân thủ chặt chẽ theo **Data Flow Isolation** và **Dependency Matrix**.

---

## 🗺️ Data Flow & Dependency Matrix

```text
STAGE 1: Foundation & Infrastructure [DONE]
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
| **Stage 1** | Foundation & Infrastructure [DONE] | 5 | Monorepo skeleton, Docker Compose runtime, Makefile, Service stubs |
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

### Stage 1 — Foundation & Infrastructure [DONE]

Mục tiêu: Dựng toàn bộ skeleton monorepo, Docker Compose runtime, `.env`, MinIO, NATS JetStream, ClickHouse và các service placeholder. Infrastructure sẵn sàng `make up` và healthcheck thành công.

```text
Stage 1 [DONE]
├── Phase 1.1: Repository Foundation           [DONE]
├── Phase 1.2: Local Runtime Infrastructure    [DONE]
├── Phase 1.3: Service Skeleton                [DONE]
├── Phase 1.4: Configuration & Environment     [DONE]
└── Phase 1.5: Development Workflow            [DONE]
```

* **Phase 1.1 — Repository Foundation [DONE]**: Khởi tạo monorepo, cấu trúc thư mục tiêu chuẩn, Git configuration, root Makefile và conventions chung.
* **Phase 1.2 — Local Runtime Infrastructure [DONE]**: Dựng MinIO, NATS JetStream bằng Docker Compose với healthchecks.
* **Phase 1.3 — Service Skeleton [DONE]**: Tạo skeleton cho Go Ingester, Rust Preprocessor, Python ML Worker, Rust Inference, Go API và Dashboard.
* **Phase 1.4 — Configuration & Environment [DONE]**: Chuẩn hóa `.env.example` sub-projects, Domain Structs, Loggers, Ports, MinIO buckets, NATS subjects.
* **Phase 1.5 — Development Workflow [DONE]**: Chuẩn hóa lệnh `make build`, `make up`, `make down`, `make lint`, `make test`, `make repo-check`, `make config-check` và smoke test script.

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

Mục tiêu: Rust Preprocessor nhận NATS event, tải FITS từ MinIO Bronze, parse & clean signal, ghi Parquet sang MinIO Silver.

```text
Stage 3
├── Phase 3.1: NATS Consumer & Event Handler
├── Phase 3.2: FITS Reader & HDU Extraction
├── Phase 3.3: Preprocessing & Data Cleaning
├── Phase 3.4: Silver Parquet Encoding
└── Phase 3.5: Preprocessing Event Publishing
```

* **Phase 3.1 — NATS Consumer & Event Handler**: Rust Preprocessor subscribe JetStream consumer `bronze-object-ready`.
* **Phase 3.2 — FITS Reader & HDU Extraction**: Tải FITS byte stream từ MinIO, parse Header & Data Units (Primary HDU, Light Curve Table HDU).
* **Phase 3.3 — Preprocessing & Data Cleaning**: Lọc mảng chất lượng (`QUALITY == 0`), normalize flux, remove background noise & outliers.
* **Phase 3.4 — Silver Parquet Encoding**: Encode mảng thời gian & flux thành Apache Parquet format nén Snappy/ZSTD.
* **Phase 3.5 — Preprocessing Event Publishing**: Ghi Parquet vào MinIO Silver (`silver/tess/...`) và publish `silver-object-ready` sang NATS.

---

### Stage 4 — Checkpoint, Recovery & Rolling Lifecycle

Mục tiêu: Đảm bảo khả năng phục hồi lỗi (idempotency, checkpoint), quản lý giới hạn dữ liệu Bronze (~50 GiB).

```text
Stage 4
├── Phase 4.1: Ingestion Checkpoints & State
├── Phase 4.2: Preprocessing Checkpoints & State
├── Phase 4.3: Retry Policy & Dead Letter Queue
├── Phase 4.4: Bronze Rolling Retention (~50 GiB)
└── Phase 4.5: Crash Recovery & Resumption Validation
```

* **Phase 4.1 — Ingestion Checkpoints & State**: Lưu vị trí stream và offset file đã tải vào SQLite/Local state.
* **Phase 4.2 — Preprocessing Checkpoints & State**: Theo dõi message deduplication ID và ack status trên NATS JetStream.
* **Phase 4.3 — Retry Policy & Dead Letter Queue**: Tự động thử lại với Exponential Backoff khi MinIO/NATS đứt kết nối, đẩy event hỏng vào DLQ.
* **Phase 4.4 — Bronze Rolling Retention (~50 GiB)**: Tự động xóa bớt các file FITS cũ nhất khi bộ nhớ Bronze vượt qua High Watermark (90%) về mức Low Watermark (60%).
* **Phase 4.5 — Crash Recovery & Resumption Validation**: Giả lập kill `-9` service và khôi phục trạng thái làm việc mà không làm mất hoặc lặp dữ liệu.

---

### Stage 5 — Gold Dataset & Scientific Analytics

Mục tiêu: Tích hợp dữ liệu danh mục khoa học (TIC Catalog, Simbad labels), tổng hợp Silver Parquet thành Gold Dataset sẵn sàng huấn luyện ML.

```text
Stage 5
├── Phase 5.1: Gold Aggregator Service
├── Phase 5.2: Catalog & Label Integration
├── Phase 5.3: Feature Engineering Pipeline
├── Phase 5.4: Gold Snapshot & Versioning
└── Phase 5.5: Dataset Validation & Quality Gates
```

* **Phase 5.1 — Gold Aggregator Service**: Gom nhóm dữ liệu chuỗi thời gian Silver theo TIC ID và Sector.
* **Phase 5.2 — Catalog & Label Integration**: Gắn nhãn khoa học (Planet candidate, Eclipsing Binary, Stellar flare, Noise/Artifact).
* **Phase 5.3 — Feature Engineering Pipeline**: Trích xuất đặc trưng chuỗi thời gian (Period, Transit depth, Duration, Standard deviation, Skewness).
* **Phase 5.4 — Gold Snapshot & Versioning**: Tạo bản đóng đóng băng Gold Dataset phiên bản hóa (`gold/v1.0/...`).
* **Phase 5.5 — Dataset Validation & Quality Gates**: Kiểm tra tỷ lệ missing values, data drift và tính toàn vẹn nhãn.

---

### Stage 6 — ML Platform & Model Evolution

Mục tiêu: Xây dựng pipeline huấn luyện ML phát hiện Exoplanet Candidates và Anomaly, export mô hình sang ONNX format.

```text
Stage 6
├── Phase 6.1: ML Training Framework & Data Loader
├── Phase 6.2: Transit Candidate Classifier Model
├── Phase 6.3: Unsupervised Anomaly Detection Model
├── Phase 6.4: Model Evaluation & Metrics Tracking
├── Phase 6.5: ONNX Export & Optimization
└── Phase 6.6: Champion / Challenger Registry
```

* **Phase 6.1 — ML Training Framework & Data Loader**: Xây dựng PyTorch Dataset/DataLoader tối ưu đọc Gold Parquet.
* **Phase 6.2 — Transit Candidate Classifier Model**: Huấn luyện mô hình 1D-CNN / Transformer phân loại tín hiệu transit.
* **Phase 6.3 — Unsupervised Anomaly Detection Model**: Huấn luyện Autoencoder / Isolation Forest phát hiện hiện tượng thiên văn dị biệt.
* **Phase 6.4 — Model Evaluation & Metrics Tracking**: Đánh giá Precision, Recall, ROC-AUC và F1-score.
* **Phase 6.5 — ONNX Export & Optimization**: Export PyTorch model sang ONNX format và tối ưu hóa graph execution.
* **Phase 6.6 — Champion / Challenger Registry**: Lưu trữ phiên bản mô hình chiến thắng và quản lý metadata phiên bản.

---

### Stage 7 — Rust Inference, Go API & Dashboard

Mục tiêu: Phục vụ mô hình ONNX siêu tốc bằng Rust, cung cấp REST/gRPC API qua Go API và hiển thị giao diện trực quan trên Dashboard.

```text
Stage 7
├── Phase 7.1: Rust ONNX Inference Engine
├── Phase 7.2: Go API Gateway & Query Endpoints
├── Phase 7.3: Real-Time Anomaly Alerting
├── Phase 7.4: Interactive Scientific Dashboard
└── Phase 7.5: End-to-End User Workflows
```

* **Phase 7.1 — Rust ONNX Inference Engine**: Tải ONNX model từ MinIO `models`, thực thi inference chuỗi thời gian với latency cực thấp.
* **Phase 7.2 — Go API Gateway & Query Endpoints**: Cung cấp API tra cứu ứng viên hành tinh, bất thường thiên văn và dữ liệu quang phổ.
* **Phase 7.3 — Real-Time Anomaly Alerting**: Phát cảnh báo ngay lập tức khi phát hiện tín hiệu có score bất thường cao.
* **Phase 7.4 — Interactive Scientific Dashboard**: Giao diện trực quan hóa đường cong ánh sáng (Light Curve), vị trí ngôi sao và kết quả dự đoán ML.
* **Phase 7.5 — End-to-End User Workflows**: Kết nối hoàn chỉnh luồng làm việc từ nhà khoa học tới hệ thống.

---

### Stage 8 — Observability, Benchmark & System Hardening

Mục tiêu: Đảm bảo tính ổn định, giám sát toàn diện thông qua Prometheus/Grafana và thực hiện stress test hiệu năng.

```text
Stage 8
├── Phase 8.1: Metrics Instrumentation & Exporters
├── Phase 8.2: Observability Dashboard
├── Phase 8.3: Throughput & Latency Benchmarks
├── Phase 8.4: Chaos Engineering & Failure Injection
├── Phase 8.5: Security & Compliance Audit
└── Phase 8.6: Final Production Gate
```

* **Phase 8.1 — Metrics Instrumentation & Exporters**: Tích hợp Prometheus client metrics cho toàn bộ 6 microservices.
* **Phase 8.2 — Observability Dashboard**: Thiết lập Grafana Dashboard theo dõi CPU, Memory, Queue Lag, Storage Budget, Inference Latency.
* **Phase 8.3 — Throughput & Latency Benchmarks**: Đo đạc khả năng xử lý hàng triệu điểm dữ liệu/giây và thời gian đáp ứng API.
* **Phase 8.4 — Chaos Engineering & Failure Injection**: Thử nghiệm hạ gục mạng, đứt MinIO, tràn bộ nhớ để kiểm tra độ bền vững.
* **Phase 8.5 — Security & Compliance Audit**: Quét lỗ hổng bảo mật container, phân quyền IAM MinIO và mã hóa data at rest.
* **Phase 8.6 — Final Production Gate**: Nghiệm thu toàn bộ nền tảng sẵn sàng vận hành thực tế.
