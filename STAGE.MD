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
STAGE 4: Checkpoint, Recovery & Rolling Lifecycle (Idempotency + Rolling ~50 GiB) [DONE]
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
| **Stage 4** | Checkpoint, Recovery & Rolling Lifecycle [DONE] | 6 | State checkpoints, idempotency, rolling Bronze window ~50 GiB |
| **Stage 5** | Gold Dataset & Scientific Analytics [DONE] | 7 | Feature engineering, catalog/labels integration, Gold snapshots, analytical query index |
| **Stage 6** | ML Platform & Model Evolution | 7 | Deterministic group splits, tabular candidate & anomaly models, Golden Test & Recent Holdout, Model Registry (Champion/Challenger), ONNX export & Rust parity |
| **Stage 7** | Rust Inference, Go API & Dashboard | 5 | Rust ONNX serving, Go Query API, Interactive Scientific Dashboard |
| **Stage 8** | Observability, Benchmark & Hardening | 6 | Prometheus/Grafana metrics, system benchmarks, end-to-end resilience |
| **Tổng** | **8 Stages** | **47 Phases** | **Full Production-Grade Data & ML Pipeline** |

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

### Stage 4 — Recovery, Idempotency & Rolling Lifecycle [DONE]

Mục tiêu: Đảm bảo khả năng phục hồi lỗi liên dịch vụ (cross-service idempotency, preprocessor checkpoint, NATS redelivery), quản lý vết dữ liệu (lineage tracking) và vòng đời bộ nhớ đệm Bronze (~50 GiB rolling window).

```text
Stage 4 [DONE]
├── Phase 4.1: Preprocessor Checkpoint & Processing State        [DONE]
├── Phase 4.2: Cross-Service Idempotency & Reconciliation        [DONE]
├── Phase 4.3: Redelivery, Retry & Poison-Message Policy         [DONE]
├── Phase 4.4: Lineage Commit & Eviction Eligibility             [DONE]
├── Phase 4.5: Rolling Bronze Window & Safe Eviction             [DONE]
└── Phase 4.6: End-to-End Recovery & Lifecycle Validation        [DONE]
```

* **Phase 4.1 — Preprocessor Checkpoint & Processing State [DONE]**: Quản lý state xử lý bền vững tại `checkpoints/preprocessing/` (`PROCESSING` -> `SILVER_STORED` -> `COMPLETED` / `FAILED`). Phục hồi mượt mà sau sự cố crash giữa bước Silver write và NATS ACK.
* **Phase 4.2 — Cross-Service Idempotency & Reconciliation [DONE]**: Xây dựng các quy tắc đối soát dữ liệu (reconciliation rules) giữa Go Ingestion state, MinIO Bronze, NATS JetStream và Rust Processing state mà không cần giao dịch phân tán (distributed transactions).
* **Phase 4.3 — Redelivery, Retry & Poison-Message Policy [DONE]**: Đóng băng chính sách xử lý lỗi: retry tự động với lỗi hạ tầng tạm thời, gửi `TERM` cho poison message, và ghi nhận trạng thái `REJECTED` cho dữ liệu lỗi khoa học vĩnh viễn.
* **Phase 4.4 — Lineage Commit & Eviction Eligibility [DONE]**: Đảm bảo hợp đồng vết dữ liệu (`source_product_id` -> Bronze -> Processor Version -> Silver). Một file Bronze thô chỉ được đánh dấu `EVICTABLE` sau khi Lineage đã được commit đầy đủ.
* **Phase 4.5 — Rolling Bronze Window & Safe Eviction [DONE]**: Tự động dọn dẹp các file FITS thô `EVICTABLE` cũ nhất khi dung lượng Bronze chạm High Watermark (~45 GiB) về mức Low Watermark (~30 GiB). Tuyệt đối không xóa Manifest, Checkpoint, Lineage, Silver hay Gold Artifacts.
* **Phase 4.6 — End-to-End Recovery & Lifecycle Validation [DONE]**: Kiểm thử ma trận phục hồi sự cố (MinIO/NATS/Go/Rust crash & restart) và nghiệm thu chính sách xóa an toàn đệm Bronze.

---

### Stage 5 — Gold Dataset & Scientific Analytics [DONE]

Mục tiêu: Tích hợp dữ liệu danh mục khoa học (TIC Catalog, TOI, TCE), trích xuất đặc trưng khoa học (Feature Engineering) từ dữ liệu Silver, tạo bản đóng băng Gold Dataset bất biến (Immutable Snapshots) và thiết lập chỉ mục truy vấn phân tích (ClickHouse Analytical Index).

> ⚠️ **Quy tắc bất biến tuyệt đối (Strict Stage 5 Invariant):**
> **Stage 5 CHỈ ĐỌC dữ liệu từ Silver (`silver/`), Lineage (`lineage/`) và Catalog/Labels versioned.**
> Tuyệt đối **KHÔNG đọc trực tiếp đệm Bronze (`bronze/` FITS files)**. 
> Stage 5 phải vận hành 100% thành công ngay cả khi dữ liệu Bronze thô đã bị xóa (`RAW_DELETED`).

```text
Stage 5
├── Phase 5.1: Gold Dataset Contract & Snapshot Identity          [DONE]
├── Phase 5.2: Light Curve Scientific Feature Engineering        [DONE]
├── Phase 5.3: TPF / FFI Vetting Evidence Features               [DONE]
├── Phase 5.4: TIC / TOI / TCE Enrichment & Label Versioning     [DONE]
├── Phase 5.5: Gold Materialization & Feature Checkpoint         [DONE]
├── Phase 5.6: Analytical Tables & Query Index                   [DONE]
└── Phase 5.7: End-to-End Gold & Scientific Analytics Validation [DONE]
```

* **Phase 5.1 — Gold Dataset Contract & Snapshot Identity [DONE]**: Định nghĩa hợp đồng dữ liệu Gold snapshot bất biến (`contracts/data/gold-snapshot-v1.md`). Quy định cấu trúc snapshot `gold/snapshots/gold-v1/<snapshot-id>/` với metadata phiên bản (`feature_versions`, `catalog_snapshots`, `label_snapshots`, `inputs`) và hàm băm SHA-256 chuẩn xác.
* **Phase 5.2 — Light Curve Scientific Feature Engineering [DONE]**: Python worker (`python-ml-worker`) đọc Silver Light Curve và trích xuất các đặc trưng khoa học (basic statistics, variability metrics, Astropy BLS period/power/depth/duration, shape skewness/kurtosis) độc lập với đệm Bronze. Hợp đồng `contracts/data/gold-lightcurve-features-v1.md`.
* **Phase 5.3 — TPF / FFI Vetting Evidence Features [DONE]**: Trích xuất các bằng chứng kỹ thuật không gian (evidence features) từ Silver TPF (`tpf-vetting-v1`: temporal MAD, transit deficit centroid) và Silver FFI (`ffi-evidence-v1`: detector context, cutout deviations) phục vụ candidate vetting và anomaly detection độc lập với đệm Bronze. Hợp đồng `contracts/data/gold-tpf-vetting-v1.md` & `gold-ffi-evidence-v1.md`.
* **Phase 5.4 — TIC / TOI / TCE Enrichment & Label Versioning [DONE]**: Tích hợp danh mục khoa học NASA (TIC, TOI, TCE) dạng snapshot bất biến (`catalogs/tess/tic/`, `toi/`, `tce/`), thực hiện ghép nối chu kỳ transit (`toi-match-v1`) và gán nhãn huấn luyện bảo thủ (`candidate-label-policy-v1`), đảm bảo không làm thay đổi các đặc trưng số liệu tín hiệu khoa học và tuyệt đối ngăn ngừa rò rỉ nhãn (label leakage). Hợp đồng `contracts/data/catalog-*.md` & `candidate-label-v1.md`.
* **Phase 5.5 — Gold Materialization & Feature Checkpoint [DONE]**: Vật thể hóa tập dữ liệu Gold Parquet theo cấu trúc phân vùng bất biến (`gold/snapshots/<snapshot-id>/data/candidate/sector=XXXX/part-00000.parquet`), nén PyArrow ZSTD, sắp xếp dòng deterministic, theo dõi tiến trình qua `checkpoints/feature-engineering/`, áp dụng thứ tự commit manifest cuối cùng và cập nhật cờ `--set-current` sản xuất. Hợp đồng `contracts/data/gold-candidate-v1.md` & `gold-anomaly-v1.md`.
* **Phase 5.6 — Analytical Tables & Query Index [DONE]**: Thiết lập lớp chỉ mục truy vấn phân tích ClickHouse (`aurora` database) chiếu dữ liệu snapshot Gold bất biến sang các bảng MergeTree (`gold_snapshots_v1`, `candidate_features_v1`, `anomaly_*_v1`) phân vùng theo `snapshot_id`, đảm bảo nguyên tắc phân lập snapshot (`WHERE snapshot_id = ...`), hỗ trợ quy trình reindex (`analytics-load --snapshot-id <id> [--rebuild]`) và đối soát dòng/chỉ số thống kê 100% trước khi ghi trạng thái `READY`. Hợp đồng `contracts/data/analytics-query-index-v1.md`.
* **Phase 5.7 — End-to-End Gold & Scientific Analytics Validation [DONE]**: Kiểm thử toàn bộ luồng từ Silver -> Python Feature Builder -> Catalog Labels -> Gold Snapshot -> Analytics Query (`tests/e2e/stage5-gold-analytics.sh`, `test_stage5_e2e.py`). Khẳng định quy trình chạy thành công 100% và tuân thủ 12 cờ bất biến kiến trúc ngay cả khi đệm Bronze đã bị xóa (`RAW_DELETED`). Báo cáo nghiệm thu `docs/STAGE5_VALIDATION.md`.

---

### Stage 6 — ML Platform & Model Evolution

Mục tiêu: Xây dựng nền tảng huấn luyện ML Gold-first, split-first, reproducibility-first, registry-driven. Quản lý toàn bộ vòng đời huấn luyện mô hình phân loại ứng viên hành tinh (Candidate Vetting) và phát hiện bất thường (Anomaly Detection), đánh giá khách quan trên Golden Test & Recent Holdout, quản lý Model Registry (Champion/Challenger, promotion & rollback), xuất định dạng ONNX và đảm bảo tính đồng nhất kết quả dự đoán với Rust Inference Engine.

> ⚠️ **Quy tắc bất biến tuyệt đối (Strict Stage 6 Invariant):**
> 1. **Dữ liệu huấn luyện chuẩn (Canonical ML Input)** bắt buộc bắt đầu từ `gold_snapshot_id` bất biến (MinIO Gold Parquet + `manifest.json`), tuyệt đối KHÔNG scan trực tiếp đệm Silver/Bronze hay đọc trực tiếp ClickHouse.
> 2. **Group-Safe Split**: Phân chia tập dữ liệu (train / validation / golden test / recent holdout) theo `group_key` (`tic_id` nếu có, ngược lại là `source_product_id`), đảm bảo cùng một target/sao KHÔNG BAO GIỜ bị rò rỉ chéo giữa các tập.
> 3. **Label Leakage & Preprocessing Fit**: Không đưa các trường supervision/audit vào model input; Preprocessor (imputer, scaler) chỉ được `fit` trên tập Train và đóng gói cùng model artifact để Rust Inference dùng lại y hệt.

```text
Stage 6
├── Phase 6.1: ML Dataset View & Deterministic Group Split
├── Phase 6.2: Candidate Vetting Model Training
├── Phase 6.3: Astronomical Anomaly Detection Training
├── Phase 6.4: Evaluation — Golden Test & Recent Holdout
├── Phase 6.5: Model Registry — Champion / Challenger, Promotion & Rollback
├── Phase 6.6: ONNX Export & Rust Inference Parity
└── Phase 6.7: End-to-End ML Training & Model Validation
```

* **Phase 6.1 — ML Dataset View & Deterministic Group Split [DONE]**: Xây dựng ranh giới đầu vào ML từ Gold candidate snapshot bất biến, hợp đồng `candidate-ml-view-v1` (`contracts/data/ml-dataset-view-v1.md`) quy định danh sách 32 đặc trưng `MODEL_INPUT` theo thứ tự cố định, chính sách nhãn `UNRESOLVED != NEGATIVE`, thuật toán phân nhóm target theo TIC ID (group-safe: same TIC → same split), phân bổ train/validation deterministic SHA-256, và lưu split manifest bất biến tại `manifests/ml-splits/<split-id>.json` (`contracts/data/ml-split-v1.md`). Triển khai trong `aurora_ml/splits.py` với CLI `ml-view` và `ml-split`. Tài liệu kiến trúc `docs/ML_DATASETS.md`. Xác nhận: 13/13 unit test PASS.
* **Phase 6.2 — Candidate Vetting Model Training**: Huấn luyện mô hình phân loại ứng viên dạng Tabular trên tập đặc trưng khoa học Gold, quản lý trạng thái tiến trình huấn luyện qua `checkpoints/ml-training/candidate/<training-run-id>.json` và đóng gói tham số preprocessor.
* **Phase 6.3 — Astronomical Anomaly Detection Training**: Huấn luyện mô hình phát hiện bất thường không giám sát (Autoencoder / Isolation Forest) trên tập đặc trưng bất thường Gold (LC, TPF, FFI evidence), đánh giá tỷ lệ cảnh báo sai (false alert rate) và độ ổn định điểm số.
* **Phase 6.4 — Evaluation — Golden Test & Recent Holdout**: Đánh giá hiệu năng mô hình khách quan trên tập Golden Test cố định (đã đóng băng) và Recent Holdout (dữ liệu/sector mới arrival), tính toán các chỉ số PR-AUC, ROC-AUC, F1, Confusion Matrix và chốt ngưỡng quyết định (decision threshold) từ tập Validation.
* **Phase 6.5 — Model Registry — Champion / Challenger, Promotion & Rollback**: Quản lý phiên bản mô hình bất biến tại `models/candidate/<model-id>/` (`manifest.json`, `model.onnx`, `preprocessing.json`, `metrics.json`), duy trì con trỏ mutable `champion.json`, thực hiện quy trình Promotion dựa trên tiêu chí PR-AUC/Recall và hỗ trợ Rollback tức thì không cần huấn luyện lại.
* **Phase 6.6 — ONNX Export & Rust Inference Parity**: Định nghĩa hợp đồng runtime liên ngôn ngữ (`contracts/data/model-runtime-v1.md`), cố định thứ tự đặc trưng (`feature_order`), đóng gói tham số biến đổi preprocessor và kiểm thử tính đồng nhất kết quả dự đoán (numeric tolerance parity) giữa Python ONNX Runtime và Rust ONNX Engine.
* **Phase 6.7 — End-to-End ML Training & Model Validation**: Kiểm thử toàn bộ quy trình từ Gold Snapshot -> Group Split -> Training -> Evaluation -> Champion Registry -> ONNX Export -> Rust Parity (`tests/e2e/stage6-ml-platform.sh`, `test_stage6_e2e.py`). Đảm bảo 100% khả năng truy xuất nguồn gốc (provenance traceability) từ model trở lại đúng Gold snapshot nguyên bản.

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
