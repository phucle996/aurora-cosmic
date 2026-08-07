# STAGE.MD — Project Execution Roadmap

Tài liệu quy định lộ trình phát triển của **AURORA Cosmic Data Platform**, được chia thành **8 Stage** và **44 Phase** tuân thủ chặt chẽ theo **Data Flow Isolation** và **Dependency Matrix**.

---

## 🗺️ Data Flow & Dependency Matrix

```text
STAGE 1: Foundation & Infrastructure [DONE]
   │
   ▼
STAGE 2: Data Source & Go Ingestion (NASA MAST -> Go -> MinIO Bronze + NATS)
   │
   ▼
STAGE 3: Rust Preprocessing Pipeline (NATS -> Rust -> MinIO Silver) [DONE]
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
| **Stage 2** | Data Source & Go Ingestion | 6 | Ingestion FITS stream sang MinIO Bronze, NATS ingestion events |
| **Stage 3** | Rust Preprocessing Pipeline [DONE] | 6 | Bounded Tokio consumer, FITS decode, LC/TPF/FFI preprocessing, MinIO Silver Parquet |
| **Stage 4** | Checkpoint, Recovery & Rolling Lifecycle | 5 | State checkpoints, idempotency, rolling Bronze window ~50 GiB |
| **Stage 5** | Gold Dataset & Scientific Analytics | 5 | Feature engineering, catalog/labels integration, Gold snapshots |
| **Stage 6** | ML Platform & Model Evolution | 6 | Candidate & anomaly models, ONNX export, Champion/Challenger |
| **Stage 7** | Rust Inference, Go API & Dashboard | 5 | Rust ONNX serving, Go Query API, Interactive Scientific Dashboard |
| **Stage 8** | Observability, Benchmark & Hardening | 6 | Prometheus/Grafana metrics, system benchmarks, end-to-end resilience |
| **Tổng** | **8 Stages** | **44 Phases** | **Full Production-Grade Data & ML Pipeline** |

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
├── Phase 2.1: MAST Discovery & Source Model
├── Phase 2.2: Product Selection, Pairing & Manifest
├── Phase 2.3: Bronze Layout & Streaming Ingestion
├── Phase 2.4: NATS Event Contract & Publishing
├── Phase 2.5: Ingestion Checkpoint & Resume
└── Phase 2.6: End-to-End Ingestion Validation
```

* **Phase 2.1 — MAST Discovery & Source Model**: Kết nối NASA MAST API, query observations (`Mast.Caom.Filtered`) và products (`Mast.Caom.Products`), phân loại TPF, Light Curve, FFI và mô hình hóa Go objects.
* **Phase 2.2 — Product Selection, Pairing & Manifest**: Tự động ghép cặp TPF/LC theo cùng TIC ID & Sector, áp dụng bộ lọc dung lượng dữ liệu và tạo manifest cho quá trình ingestion.
* **Phase 2.3 — Bronze Layout & Streaming Ingestion**: Go Ingester stream FITS trực tiếp vào MinIO Bronze qua HTTP `io.Reader` theo chuẩn layout `bronze/tess/year/sector/tic_id/filename.fits` mà không phình RAM.
* **Phase 2.4 — NATS Event Contract & Publishing**: Định nghĩa event schema và publish `bronze-object-ready` event lên NATS JetStream sau khi upload xong object.
* **Phase 2.5 — Ingestion Checkpoint & Resume**: Lưu checkpoint trạng thái ingestion vào SQLite/Local state để đảm bảo khả năng resume và idempotency khi bị gián đoạn.
* **Phase 2.6 — End-to-End Ingestion Validation**: Kiểm thử toàn bộ quy trình ingestion từ MAST -> MinIO Bronze -> NATS Event mà không tải file FITS dư thừa hay làm phình RAM.

---

### Stage 3 — Rust Preprocessing Pipeline [DONE]

Mục tiêu: Rust Preprocessor nhận NATS `bronze-object-ready` event, tải FITS từ MinIO Bronze, parse & clean signal theo từng product kind (LC / TPF / FFI), ghi Arrow/Parquet sang MinIO Silver, ACK JetStream chỉ sau khi Silver write durable.

> ⚠️ **Scope boundary Stage 3:**
> - `output/gold.rs` **KHÔNG implement** — Gold thuộc Stage 5.
> - `checkpoint.rs` chỉ là **stub** — Full checkpoint/idempotency thuộc Stage 4.
> - `spawn_blocking` bắt buộc cho mọi FITS parsing (CFITSIO blocking I/O không chạy trực tiếp trong async Tokio executor).
> - ACK JetStream **chỉ sau khi Silver write verify durable**, không ACK sớm.

```text
Stage 3 [DONE]
├── Phase 3.1: JetStream Consumer & Bounded Runtime       [DONE]
├── Phase 3.2: Bronze Fetch & FITS Decode                 [DONE]
├── Phase 3.3: Light Curve Preprocessing                  [DONE]
├── Phase 3.4: TPF / FFI Image Preprocessing              [DONE]
├── Phase 3.5: Silver Schema & Materialization            [DONE]
└── Phase 3.6: End-to-End Preprocessing Validation        [DONE]
```

* **Phase 3.1 — JetStream Consumer & Bounded Runtime [DONE]**: Rust Preprocessor subscribe JetStream consumer `bronze-object-ready`. Bounded concurrency bắt buộc qua `Semaphore(N)` (config: `AURORA_PREPROCESS_WORKERS`). Không dùng `tokio::spawn` vô hạn. ACK strategy: chỉ ACK sau khi downstream output durable.

* **Phase 3.2 — Bronze Fetch & FITS Decode [DONE]**: Nhận `bucket` + `object_key` + `product_kind` từ NATS event, GET object từ MinIO Bronze, verify `size` & `sha256`, decode FITS qua `spawn_blocking`. Hỗ trợ: `TARGET_PIXEL`, `LIGHT_CURVE`, `FFI`.

* **Phase 3.3 — Light Curve Preprocessing [DONE]**: Đọc `TIME`, `PDCSAP_FLUX`, `PDCSAP_FLUX_ERR`, `QUALITY` từ `*_lc.fits`. Pipeline: remove invalid rows → quality mask → normalize flux → basic outlier handling → Silver Light Curve. Không nhét transit feature engineering (Period, BLS score, Transit depth) — đó là Stage 5 Gold.

* **Phase 3.4 — TPF / FFI Image Preprocessing [DONE]**: TPF: quality filtering → background normalization → cutout statistics → Silver. FFI: metadata extraction → optional bounded cutout → Silver image metadata. Không convert toàn bộ FFI thành giant tensor cho ML.

* **Phase 3.5 — Silver Schema & Materialization [DONE]**: Freeze Arrow/Parquet schema cho Silver Light Curve và Silver Image trước Stage 5. Output layout `silver/tess/lightcurve/sector=NNNN/tic=NNNNNNNNN/` và `silver/tess/target-pixel/...`. Schema contract có thể document tại `contracts/data/`.

* **Phase 3.6 — End-to-End Preprocessing Validation [DONE]**: Test flow thật: `NATS bronze-object-ready` → MinIO Bronze → Rust Preprocessor → MinIO Silver cho cả 3 loại (LC event, TPF event, FFI event). Validate ACK ordering: Silver write → verify durable → ACK (không ACK trước khi process).

---

### Stage 4 — Recovery, Idempotency & Rolling Lifecycle

Mục tiêu: Đảm bảo khả năng phục hồi lỗi liên dịch vụ (cross-service idempotency, preprocessor checkpoint, NATS redelivery), quản lý vết dữ liệu (lineage tracking) và vòng đời bộ nhớ đệm Bronze (~50 GiB rolling window).

```text
Stage 4
├── Phase 4.1: Preprocessor Checkpoint & Processing State
├── Phase 4.2: Cross-Service Idempotency & Reconciliation
├── Phase 4.3: Redelivery, Retry & Poison-Message Policy
├── Phase 4.4: Lineage Commit & Eviction Eligibility
├── Phase 4.5: Rolling Bronze Window & Safe Eviction
└── Phase 4.6: End-to-End Recovery & Lifecycle Validation
```

* **Phase 4.1 — Preprocessor Checkpoint & Processing State [DONE]**: Quản lý state xử lý bền vững tại `checkpoints/preprocessing/` (`PROCESSING` -> `SILVER_STORED` -> `COMPLETED` / `FAILED`). Phục hồi mượt mà sau sự cố crash giữa bước Silver write và NATS ACK.
* **Phase 4.2 — Cross-Service Idempotency & Reconciliation**: Xây dựng các quy tắc đối soát dữ liệu (reconciliation rules) giữa Go Ingestion state, MinIO Bronze, NATS JetStream và Rust Processing state mà không cần giao dịch phân tán (distributed transactions).
* **Phase 4.3 — Redelivery, Retry & Poison-Message Policy**: Đóng băng chính sách xử lý lỗi: retry tự động với lỗi hạ tầng tạm thời, gửi `TERM` cho poison message, và ghi nhận trạng thái `REJECTED` cho dữ liệu lỗi khoa học vĩnh viễn.
* **Phase 4.4 — Lineage Commit & Eviction Eligibility**: Đảm bảo hợp đồng vết dữ liệu (`source_product_id` -> Bronze -> Processor Version -> Silver). Một file Bronze thô chỉ được đánh dấu `EVICTABLE` sau khi Lineage đã được commit đầy đủ.
* **Phase 4.5 — Rolling Bronze Window & Safe Eviction**: Tự động dọn dẹp các file FITS thô `EVICTABLE` cũ nhất khi dung lượng Bronze chạm High Watermark (~45 GiB) về mức Low Watermark (~30 GiB). Tuyệt đối không xóa Manifest, Checkpoint, Lineage, Silver hay Gold Artifacts.
* **Phase 4.6 — End-to-End Recovery & Lifecycle Validation**: Kiểm thử ma trận phục hồi sự cố (MinIO/NATS/Go/Rust crash & restart) và nghiệm thu chính sách xóa an toàn đệm Bronze.

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
