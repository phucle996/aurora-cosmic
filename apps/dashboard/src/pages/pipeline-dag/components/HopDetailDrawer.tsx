import { useEffect, useState, type JSX } from 'react';
import { Activity, Calculator, FileText, Loader2, Workflow, X } from 'lucide-react';

import { apiFetch } from '@/lib/api';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerHeader,
  DrawerTitle,
} from '@/components/ui/drawer';
import type { Hop } from '../types';
import {
  AckDeliveryChart,
  BLSSearchChart,
  CadenceTimelineChart,
  CandidateAssemblyChart,
  CatalogResolutionChart,
  CheckpointMetricsChart,
  EventPublishChart,
  GoldCommitChart,
  GoldPhaseChart,
  GoldMaterializationChart,
  GoldProjectionChart,
  LCDetrendChart,
  LCParquetChart,
  LightCurveFeaturesChart,
  LineageLedgerChart,
  PairingReadinessChart,
  ProductDemuxChart,
  QualityMaskChart,
  ResidualsDistributionChart,
  SilverMaterializationChart,
  TPFParquetChart,
  TPFQualityWCSChart,
  TPFSpatialEvidenceChart,
  TPFTransformChart,
} from './hop-charts';

// Hàm render chart tương ứng với từng Hop id kèm mode, metrics và số tệp cộng dồn
function renderHopChart(
  hopId: string,
  mode: 'stream' | 'batch' = 'batch',
  totalFiles: number = 0,
  metrics?: Record<string, number>,
  telemetry?: Record<string, Array<{ timestamp: number; value: number }>>,
  scatterPoints?: Hop['scatter_points'],
  tpfTransformPoints?: Hop['tpf_transform_points'],
  materializationPoints?: Hop['materialization_points'],
  encodeFailures?: Hop['encode_failures'],
  silverFailures?: Hop['silver_failures'],
  checkpointPoints?: Hop['checkpoint_points'],
  details?: Hop['details'],
  lcFeatureEvidence?: Hop['lc_feature_evidence'],
  blsSearchEvidence?: Hop['bls_search_evidence'],
  tpfSpatialEvidence?: Hop['tpf_spatial_evidence'],
  candidateAssemblyEvidence?: Hop['candidate_assembly_evidence'],
  goldMaterializationEvidence?: Hop['gold_materialization_evidence'],
  goldProjectionEvidence?: Hop['gold_projection_evidence'],
  goldCommitEvidence?: Hop['gold_commit_evidence'],
): JSX.Element | null {
  switch (hopId) {
    case 'bronze':
      return <CadenceTimelineChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'route':
      return <ProductDemuxChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'decode':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'lc-quality':
      return <QualityMaskChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} modality="lightcurve" />;
    case 'tpf-quality':
      return <TPFQualityWCSChart mode={mode} totalFiles={totalFiles} metrics={metrics} telemetry={telemetry} />;
    case 'transform':
      return <ResidualsDistributionChart metrics={metrics} telemetry={telemetry} scatterPoints={scatterPoints} tpfTransformPoints={tpfTransformPoints} />;
    case 'lc-transform':
      return <LCDetrendChart metrics={metrics} telemetry={telemetry} scatterPoints={scatterPoints} />;
    case 'tpf-transform':
      return <TPFTransformChart metrics={metrics} telemetry={telemetry} tpfTransformPoints={tpfTransformPoints} />;
    case 'silver':
      return <SilverMaterializationChart metrics={metrics} telemetry={telemetry} materializationPoints={materializationPoints} encodeFailures={encodeFailures} silverFailures={silverFailures} />;
    case 'lc-parquet':
      return <LCParquetChart metrics={metrics} telemetry={telemetry} materializationPoints={materializationPoints} encodeFailures={encodeFailures} />;
    case 'tpf-parquet':
      return <TPFParquetChart metrics={metrics} telemetry={telemetry} materializationPoints={materializationPoints} encodeFailures={encodeFailures} />;
    case 'checkpoint':
      return <CheckpointMetricsChart metrics={metrics} checkpoints={checkpointPoints} materializationPoints={materializationPoints} />;
    case 'lineage':
      return <LineageLedgerChart mode={mode} metrics={metrics} materializationPoints={materializationPoints} />;
    case 'event':
      return <EventPublishChart metrics={metrics} materializationPoints={materializationPoints} />;
    case 'ack':
      return <AckDeliveryChart metrics={metrics} materializationPoints={materializationPoints} />;
    case 'gold-pairing':
      return metrics?.readiness_observed === 1
        ? <PairingReadinessChart metrics={metrics} />
        : <GoldPhaseChart metrics={metrics} telemetry={telemetry} phase={hopId} />;
    case 'gold-catalog':
      return metrics?.catalog_observed === 1
        ? <CatalogResolutionChart metrics={metrics} details={details} />
        : <GoldPhaseChart metrics={metrics} telemetry={telemetry} phase={hopId} />;
    case 'gold-lc-features':
      return <LightCurveFeaturesChart metrics={metrics} evidence={lcFeatureEvidence} />;
    case 'gold-bls':
      return <BLSSearchChart metrics={metrics} evidence={blsSearchEvidence} />;
    case 'gold-tpf-evidence':
      return <TPFSpatialEvidenceChart metrics={metrics} evidence={tpfSpatialEvidence} />;
    case 'gold-candidate':
      return <CandidateAssemblyChart metrics={metrics} evidence={candidateAssemblyEvidence} />;
    case 'gold-parquet':
      return <GoldMaterializationChart metrics={metrics} evidence={goldMaterializationEvidence} />;
    case 'gold-index':
      return <GoldProjectionChart metrics={metrics} evidence={goldProjectionEvidence} />;
    case 'gold-commit':
      return <GoldCommitChart metrics={metrics} evidence={goldCommitEvidence} />;
    default:
      return <StageEvidence metrics={metrics} />;
  }
}

function StageEvidence({ metrics }: { metrics?: Record<string, number> }): JSX.Element {
  const observed = Object.entries(metrics ?? {}).filter(([, value]) => Number.isFinite(value) && value > 0).slice(0, 12);
  if (observed.length === 0) return <div className="border border-dashed border-border/70 p-8 text-center text-xs text-muted-foreground">Phase chưa có scalar evidence riêng.</div>;
  return <div className="grid gap-px border border-border/70 bg-border/70 sm:grid-cols-2 xl:grid-cols-3">{observed.map(([key, value]) => <div key={key} className="bg-background p-3"><p className="font-mono text-[9px] uppercase tracking-[0.1em] text-muted-foreground">{key.replaceAll('_', ' ')}</p><p className="mt-1 font-mono text-sm font-semibold">{value.toLocaleString(undefined, { maximumFractionDigits: 3 })}</p></div>)}</div>;
}

type ScientificReference = {
  formulas: Array<{ label: string; expression: string }>;
  terms: Array<{ term: string; meaning: string }>;
};

function scientificReference(hop: Hop): ScientificReference {
  const references: Record<string, ScientificReference> = {
    bronze: {
      formulas: [
        { label: 'Staged integrity', expression: 'verified = size_bytes > 0 ∧ sha256_match' },
        { label: 'Footprint ratio', expression: 'stored GiB = Σ file bytes / 2³⁰' },
      ],
      terms: [
        { term: 'Bronze FITS', meaning: 'Tệp FITS thiên văn học thô tải trực tiếp từ NASA MAST hoặc S3 staging.' },
        { term: 'Checksum Gate', meaning: 'Kiểm tra mã băm SHA-256 bảo đảm tệp nguyên vẹn, không bị hỏng hóc khi truyền nhận.' },
        { term: 'Awaiting Silver', meaning: 'Số tệp Bronze đang nằm trong vùng đệm chưa được seal thành checkpoint Silver.' },
      ],
    },
    route: {
      formulas: [
        { label: 'Demux balance ratio', expression: 'LC split % = LC products / (LC + TPF) × 100%' },
        { label: 'Dispatch throughput', expression: 'rate = d(LC + TPF) / dt' },
      ],
      terms: [
        { term: 'Product Demux', meaning: 'Đọc FITS header cards (XTENSION, EXTNAME) để phân loại và tách luồng song song.' },
        { term: 'Light Curve (Stream 03A)', meaning: 'Chuỗi dữ liệu 1D thời gian biểu diễn biến thiên thông lượng ánh sáng của sao.' },
        { term: 'Target Pixel (Stream 03B)', meaning: 'Mảng ảnh 2D (11×11 pixel postage stamps) phục vụ kiểm định độ dịch chuyển centroid.' },
      ],
    },
    'lc-quality': {
      formulas: [
        { label: 'Tỷ lệ giữ lại', expression: 'retention = valid cadences / input cadences × 100%' },
        { label: 'Cadence hợp lệ', expression: 'quality = 0 ∧ finite(time, flux) ∧ time > 0' },
      ],
      terms: [
        { term: 'Cadence', meaning: 'Một thời điểm lấy mẫu độ sáng.' },
        { term: 'Quality flag', meaning: 'Cờ TESS đánh dấu mẫu có nguy cơ bị lỗi thiết bị hoặc quan sát.' },
      ],
    },
    'tpf-quality': {
      formulas: [
        { label: 'Spatial grid geometry', expression: 'stamp shape = 11 × 11 = 121 px/frame' },
        { label: 'Finite pixel fraction', expression: 'finite px = finite_count / (N_frames × 121) × 100%' },
        { label: 'WCS astrometry solution', expression: 'RA/Dec = WCS(x, y, CRVAL, CDELT, PC)' },
      ],
      terms: [
        { term: '11×11 Postage Stamp', meaning: 'Ma trận tem ảnh 2 chiều cắt xung quanh tọa độ thiên văn của ngôi sao mục tiêu.' },
        { term: 'WCS Astrometry', meaning: 'Hệ tọa độ thiên cầu thế giới (World Coordinate System) ánh xạ pixel (x, y) sang thiên kinh RA / thiên vĩ Dec.' },
        { term: 'Finite Pixel Density', meaning: 'Tỷ lệ điểm ảnh có giá trị số học hữu hạn, không bị dead/null/NaN trên cảm biến CCD.' },
        { term: 'Aperture Mask', meaning: 'Mặt nạ phân vùng không gian tách biệt giữa ánh sáng sao (Core PSF) và nền trời (Sky Background).' },
      ],
    },
    'lc-transform': {
      formulas: [
        { label: 'Median normalization', expression: 'fᵢ = Fᵢ / median(F) − 1' },
        { label: 'Flux Scatter', expression: 'scatter_ppm = stddev(f) × 10⁶' },
        { label: 'Ngưỡng Sigma-clipping', expression: '|fᵢ − median(f)| ≤ 3.0σ (giữ cadences; ≥ 5.0σ loại spike)' },
        { label: 'Độ sâu transit tương đối', expression: 'ΔF / F = depth_ppm × 10⁻⁶' },
        { label: 'Bảo toàn trắc quang', expression: 'scatter_after ≤ scatter_before' },
      ],
      terms: [
        { term: 'PDC-SAP Flux', meaning: 'Pre-search Data Conditioning Simple Aperture Photometry; chuỗi thông lượng đã khử trôi dạt và nhiễu hệ thống TESS.' },
        { term: 'Ngưỡng Sigma (3σ / 5σ)', meaning: '< 3σ bảo toàn lòng chảo transit; 3–5σ vùng đệm kiểm tra; ≥ 5σ loại bỏ tia vũ trụ / spike cực đoan.' },
        { term: 'Scatter (ppm)', meaning: 'Thước đo tán xạ trắc quang đo bằng phần triệu (parts per million); 10,000 ppm tương đương 1% biến thiên ánh sáng.' },
        { term: 'Bảo toàn transit sâu', meaning: 'Bảo toàn đầy đủ lòng chảo quá cảnh của các ngoại hành tinh lớn (Hot Jupiter ~10,000–20,000 ppm), không làm suy hao tín hiệu.' },
        { term: 'Đường tham chiếu y = x', meaning: 'Đường so sánh phân bố trước/sau xử lý; các điểm nằm phía dưới đường biểu thị độ tán xạ giảm thành công.' },
      ],
    },
    'tpf-transform': {
      formulas: [
        { label: 'Chuẩn hóa thông lượng điểm ảnh', expression: "p′ₜᵣ𝒸 = pₜᵣ𝒸 / medianₜ(pₜᵣ𝒸) − 1 (khi median > 0, ngược lại = 0)" },
        { label: 'Tán xạ trắc quang robust (MAD)', expression: 'MADᵣ𝒸 = 1.4826 × medianₜ(|p′ₜᵣ𝒸 − medianₜ(p′ᵣ𝒸)|) × 10⁶ ppm' },
        { label: 'Độ trôi đường nền (Temporal Drift)', expression: 'Drift = (|median_half2 − median_half1| / |median_full|) × 10⁶ ppm' },
        { label: 'Độ gián đoạn nối chunk (Seam Jump)', expression: 'Jump_boundary = |p_chunk2_first − p_chunk1_last| × 10⁶ ppm' },
        { label: 'Tỷ lệ bảo toàn điểm ảnh (Finite Density)', expression: 'Ratio_finite = N_finite / N_total = 100.0%' },
      ],
      terms: [
        { term: 'Temporal Median Reference', meaning: 'Đường nền trung vị thời gian m_rc của từng pixel trong ma trận 11×11 để chuẩn hóa thông lượng.' },
        { term: 'Pixel Scatter MAD', meaning: 'Độ phân tán trắc quang robust của từng pixel qua chuỗi quan sát, đo lường bằng ppm.' },
        { term: 'Reference Baseline Drift', meaning: 'Độ trôi dạt đường nền trung vị giữa 2 nửa chuỗi thời gian, đánh giá độ ổn định lâu dài.' },
        { term: 'Chunk Boundary Jump', meaning: 'Độ lệch quang thông tại ranh giới nối giữa các chunk phân mảnh bộ nhớ của worker preprocessor.' },
        { term: 'Invalid Reference Floor', meaning: 'Các pixel nền trời có thông lượng trung vị ≤ 0 được đưa về baseline an toàn 0.0 để tránh chia cho 0.' },
      ],
    },
    'lc-parquet': {
      formulas: [
        { label: 'Hệ số nén Parquet', expression: 'compression_ratio = Bronze FITS bytes / Silver Parquet bytes' },
        { label: 'Dung lượng trung bình', expression: 'mean_size = silver_bytes / completed_lightcurves' },
        { label: 'Mật độ cadence', expression: 'cadences_per_file = total_cadences / completed_lightcurves' },
        { label: 'Ngân sách độ trễ P95', expression: 'encode_latency_p95 ≤ 100 ms' },
      ],
      terms: [
        { term: 'silver-lightcurve-v1', meaning: 'Hợp đồng schema Parquet chuẩn hóa 4 cột: time (BJD float64), flux (float32), flux_err (float32), quality (uint32).' },
        { term: 'Columnar Compression', meaning: 'Nén theo cột ZSTD/Snappy tận dụng độ tương quan giữa các cadence liên tiếp, tiết kiệm >80% dung lượng đĩa.' },
        { term: 'BJD Barycentric Time', meaning: 'Thời gian đã hiệu chỉnh về khối tâm Hệ Mặt Trời, độ chính xác float64 micro-giây phục vụ khớp mô hình Kepler.' },
        { term: 'Dictionary Encoding', meaning: 'Mã hóa từ điển tự động gom nhóm cờ quality bitmask, giảm kích thước cột cờ xuống dưới 2% dung lượng gốc.' },
      ],
    },
    'tpf-parquet': {
      formulas: [
        { label: 'Hệ số nén khối TPF', expression: 'compression_ratio = Bronze TPF bytes / Silver TPF bytes' },
        { label: 'Kích thước tem ảnh', expression: 'stamp geometry = 11 × 11 = 121 pixels/cadence' },
        { label: 'Mật độ pixel đã nén', expression: 'total_pixels = retained_cadences × 121 pixels' },
        { label: 'Chunk Row-Group Budget', expression: 'chunk_duration_p95 ≤ 2.5 s' },
      ],
      terms: [
        { term: 'silver-target-pixel-v1', meaning: 'Schema Parquet phân chia theo Row Group: cadence, time, 121 pixel flux, background nền trời và WCS astrometry.' },
        { term: 'Row-Group Chunking', meaning: 'Chia khối 3D TPF thành các Row Group độc lập giúp worker downstream đọc từng đoạn thời gian mà không cần nạp cả cube 10MB vào RAM.' },
        { term: 'WCS Astrometry Binding', meaning: 'Liên kết ma trận xoay và tỷ lệ pixel (21 arcsec/px) trực tiếp vào metadata Parquet phục vụ đo trắc tinh tâm sao.' },
      ],
    },
    silver: {
      formulas: [
        { label: 'Size verification', expression: 'size_ok = stored bytes = checkpoint expected bytes' },
        { label: 'SHA binding', expression: 'sha_ok = object metadata silver_sha256 = checkpoint silver_sha256' },
        { label: 'Integrity contract', expression: 'verified = exists ∧ size_ok ∧ sha_ok ∧ schema_ok ∧ lineage_bound' },
      ],
      terms: [
        { term: 'Checkpoint linked', meaning: 'Silver object key xuất hiện trong một completed preprocessing checkpoint.' },
        { term: 'SHA metadata binding', meaning: 'SHA-256 tính trên Parquet local trước upload khớp giữa object metadata và checkpoint.' },
        { term: 'Schema verified', meaning: 'Schema version trong object metadata khớp schema đã commit vào checkpoint.' },
        { term: 'Lineage bound', meaning: 'Object giữ đầy đủ Bronze object key và Bronze SHA-256 nguồn.' },
      ],
    },
    checkpoint: {
      formulas: [
        { label: 'Completion rate', expression: 'completed checkpoints / persisted checkpoints × 100%' },
        { label: 'Resume-ready', expression: 'state = COMPLETED ∧ verified Silver binding' },
        { label: 'Lifecycle elapsed', expression: 'checkpoint.updated_at − checkpoint.created_at' },
      ],
      terms: [
        { term: 'Reuse & ACK', meaning: 'Checkpoint COMPLETED và Silver còn nguyên vẹn; worker có thể bỏ qua xử lý khoa học.' },
        { term: 'Verify Silver', meaning: 'Artifact đã được ghi nhưng checkpoint cần được xác minh rồi mới promote.' },
        { term: 'Reprocess', meaning: 'Không đủ bằng chứng bền vững; worker phải dựng lại từ Bronze theo cùng fingerprint.' },
        { term: 'Attempt', meaning: 'Số lần cùng checkpoint identity đã đi qua đường xử lý hoặc recovery.' },
      ],
    },
    lineage: {
      formulas: [
        { label: 'Dung lượng tiết kiệm', expression: 'saved_GB = (Bronze bytes − Silver bytes) / 10⁹' },
        { label: 'Mức giảm', expression: 'reduction = saved bytes / Bronze bytes × 100%' },
        { label: 'Hệ số nén', expression: 'compression factor = Bronze bytes / Silver bytes' },
      ],
      terms: [
        { term: 'GB', meaning: 'Gigabyte thập phân, bằng 10⁹ byte; khác GiB = 2³⁰ byte.' },
        { term: 'Stored footprint', meaning: 'Dung lượng object thực tế do MinIO trả về, không phải kích thước dữ liệu tạm trong RAM.' },
        { term: 'Attributable bytes', meaning: 'Mỗi byte Silver được nối với FITS Bronze nguồn qua object key và checksum lineage.' },
      ],
    },
    event: {
      formulas: [
        { label: 'Publish amplification', expression: 'durable emissions / eligible Silver artifacts' },
        { label: 'Replay emissions', expression: 'max(0, durable emissions − eligible artifacts)' },
        { label: 'Mean envelope', expression: 'AURORA_SILVER stream bytes / durable emissions' },
      ],
      terms: [
        { term: 'Durable emission', meaning: 'Một Silver-ready message đã được JetStream xác nhận và giữ trong AURORA_SILVER.' },
        { term: 'Replay emission', meaning: 'Lần publish thêm của cùng tập artifact trong recovery hoặc Bronze redelivery.' },
        { term: 'Eligible artifact', meaning: 'Silver object đã qua integrity, checkpoint và lineage trước khi được phép publish.' },
        { term: 'Consumer', meaning: 'Downstream JetStream consumer đang gắn với Silver event stream.' },
      ],
    },
    ack: {
      formulas: [
        { label: 'ACK coverage', expression: 'acknowledged stream positions / retained Bronze stream messages × 100%' },
        { label: 'Delivery amplification', expression: 'consumer delivery attempts / unique delivered stream positions' },
        { label: 'Historical redelivery', expression: 'delivery attempts − delivered stream positions' },
      ],
      terms: [
        { term: 'Stream position', meaning: 'Identity tuần tự duy nhất của một message trong AURORA_BRONZE.' },
        { term: 'ACK floor', meaning: 'Vị trí liên tục cao nhất mà durable consumer đã xác nhận hoàn tất.' },
        { term: 'ACK pending', meaning: 'Message đã delivery nhưng consumer chưa gửi ACK thành công.' },
        { term: 'Redelivery', meaning: 'Cùng stream position được giao lại sau NAK, timeout hoặc lỗi ACK.' },
        { term: 'TERM', meaning: 'Kết thúc redelivery cho lỗi xác định là terminal; không đồng nghĩa xử lý khoa học thành công.' },
      ],
    },
    'gold-pairing': {
      formulas: [
        { label: 'Pair coverage', expression: 'eligible LC / (eligible LC + LC missing TPF) × 100%' },
        { label: 'Contract coverage', expression: 'contracted LC / (contracted LC + fallback LC) × 100%' },
        { label: 'First-batch fill', expression: 'min(eligible LC, batch capacity) / batch capacity × 100%' },
      ],
      terms: [
        { term: 'Eligible pair', meaning: 'Light Curve có Target Pixel context được backend ghép hợp lệ và có thể vào Gold batch.' },
        { term: 'Missing TPF', meaning: 'Light Curve chưa tìm thấy Target Pixel context tương ứng nên chưa được admission.' },
        { term: 'Durable contract', meaning: 'Liên kết nguồn LC tới TPF được giữ từ ingestion contract, không dựa vào suy đoán tên file.' },
        { term: 'TPF context', meaning: 'Target Pixel context hiện có để pairing; chỉ số này không tự chứng minh context đang mồ côi.' },
        { term: 'Batch admission', meaning: 'Tập cặp hợp lệ được đưa vào một Gold batch theo giới hạn cấu hình.' },
      ],
    },
    'gold-catalog': {
      formulas: [
        { label: 'TIC resolution coverage', expression: 'resolved TIC records / batch target count × 100%' },
        { label: 'TIC unresolved', expression: 'max(0, batch target count − resolved TIC records)' },
        { label: 'TOI record density', expression: 'TOI association rows / batch target count' },
      ],
      terms: [
        { term: 'Batch target count', meaning: 'Số TIC ID duy nhất trong Gold batch đang được catalog resolution.' },
        { term: 'TIC', meaning: 'TESS Input Catalog; stellar context bắt buộc cho từng target của batch.' },
        { term: 'TOI', meaning: 'TESS Object of Interest; association bổ sung, không bắt buộc tồn tại cho mọi TIC.' },
        { term: 'TOI density', meaning: 'Số TOI record trên mỗi target; không phải unique-target coverage hoặc xác suất hành tinh.' },
        { term: 'Catalog snapshot', meaning: 'Định danh immutable của catalog input được ghim cho đúng batch.' },
      ],
    },
    'gold-lc-features': {
      formulas: [
        { label: 'Observation baseline', expression: 'time span = max(time) − min(time)' },
        { label: 'Median cadence', expression: 'median cadence = median(diff(time))' },
        { label: 'Largest gap', expression: 'max gap = max(diff(time))' },
        { label: 'Flux scatter', expression: 'σ_flux = sqrt(mean((flux − mean(flux))²))' },
        { label: 'Robust amplitude', expression: 'amplitude = P95(flux) − P05(flux)' },
        { label: 'Flux RMS', expression: 'RMS = sqrt(mean(flux²))' },
      ],
      terms: [
        { term: 'Feature row', meaning: 'Một vector thống kê xác định được trích từ một Silver Light Curve.' },
        { term: 'Observation baseline', meaning: 'Khoảng thời gian từ cadence đầu đến cadence cuối của Light Curve.' },
        { term: 'Median cadence', meaning: 'Khoảng thời gian lấy mẫu điển hình giữa hai điểm liên tiếp.' },
        { term: 'Largest gap', meaning: 'Khoảng trống quan sát lớn nhất; dùng để nhận biết sampling bị gián đoạn.' },
        { term: 'ppm', meaning: 'Parts per million của normalized flux; 10.000 ppm tương đương biến thiên 1%.' },
        { term: 'Quantile profile', meaning: 'Các mốc phân vị trên toàn bộ Light Curve của snapshot, không phải chuỗi thời gian.' },
      ],
    },
    'gold-bls': {
      formulas: [
        { label: 'Search upper bound', expression: 'effective P_max = min(configured P_max, observation baseline / 2)' },
        { label: 'Best periodic box', expression: '(P*, D*) = arg max power_BLS(P, D)' },
        { label: 'Transit depth', expression: 'depth = |fitted box depth| × 10⁶ ppm' },
        { label: 'Availability', expression: 'available / evaluated Light Curves × 100%' },
      ],
      terms: [
        { term: 'BLS', meaning: 'Box Least Squares; tìm tín hiệu giảm sáng tuần hoàn gần dạng hộp.' },
        { term: 'Best period', meaning: 'Chu kỳ tại peak power lớn nhất trên lưới tìm kiếm, chưa phải chu kỳ hành tinh được xác nhận.' },
        { term: 'Duration', meaning: 'Độ rộng của box giảm sáng phù hợp nhất tại nghiệm BLS.' },
        { term: 'Depth', meaning: 'Biên độ giảm sáng của fitted box, biểu diễn bằng ppm.' },
        { term: 'Power', meaning: 'Độ mạnh tương đối của nghiệm trên periodogram; không phải probability.' },
        { term: 'Unavailable', meaning: 'Không tạo được BLS evidence hợp lệ; không đồng nghĩa pipeline failure hoặc non-planet.' },
      ],
    },
    'gold-tpf-evidence': {
      formulas: [
        { label: 'Pixel MAD', expression: 'MADⱼ = medianₜ(|pₜⱼ − medianₜ(pⱼ)|)' },
        { label: 'Variability concentration', expression: 'peak fraction = max(MADⱼ) / Σⱼ MADⱼ × 100%' },
        { label: 'Positive transit deficit', expression: 'deficitⱼ = max(median_out(pⱼ) − median_in(pⱼ), 0)' },
        { label: 'Deficit centroid', expression: '(r̄, c̄) = Σⱼ deficitⱼ·(rⱼ,cⱼ) / Σⱼ deficitⱼ' },
        { label: 'Center offset', expression: 'offset = sqrt((r̄−r_center)² + (c̄−c_center)²)' },
      ],
      terms: [
        { term: 'Deficit map', meaning: 'Ảnh chênh lệch dương giữa median ngoài transit và median trong transit.' },
        { term: 'Deficit centroid', meaning: 'Tâm có trọng số của phần flux giảm trên các pixel.' },
        { term: 'Center offset', meaning: 'Khoảng cách từ deficit centroid tới tâm hình học của TPF cutout, đo bằng pixel.' },
        { term: 'Variability peak fraction', meaning: 'Tỷ trọng variability nằm ở pixel biến thiên mạnh nhất.' },
        { term: 'Unavailable', meaning: 'Không đủ ephemeris hoặc cadence transit-window; không đồng nghĩa TPF processing failure.' },
      ],
    },
    'gold-candidate': {
      formulas: [
        { label: 'Assembly coverage', expression: '2 × candidate rows / (LC feature rows + TPF evidence rows) × 100%' },
        { label: 'Evidence-layer coverage', expression: 'rows with layer / candidate rows × 100%' },
        { label: 'TOI association coverage', expression: '(EPHEMERIS_MATCH + PERIOD_ONLY) / candidate rows × 100%' },
      ],
      terms: [
        { term: 'Candidate row', meaning: 'Canonical row kết hợp LC identity, TPF context, catalog context và các evidence khả dụng.' },
        { term: 'Assembly contract', meaning: 'Mỗi candidate row đại diện đúng một LC feature row và một paired TPF context.' },
        { term: 'Evidence tier', meaning: 'Nhóm loại trừ nhau mô tả mức BLS/spatial/TIC coverage của candidate.' },
        { term: 'TOI association', meaning: 'Liên kết tới catalog TOI theo TIC và period/ephemeris; là context tùy chọn.' },
        { term: 'Period mismatch', meaning: 'Target có TOI nhưng BLS period không khớp period hoặc harmonic được hỗ trợ.' },
        { term: 'Candidate ≠ confirmed planet', meaning: 'Row là đối tượng nghiên cứu có provenance, chưa phải kết luận vật lý.' },
      ],
    },
    'gold-parquet': {
      formulas: [
        { label: 'Row accounting', expression: 'Σ artifact rows = manifest row_count = batch candidate_rows' },
        { label: 'Mean artifact size', expression: 'Σ stored bytes / artifact count' },
        { label: 'Storage density', expression: 'bytes per row = artifact size_bytes / artifact row_count' },
        { label: 'Object size integrity', expression: 'stored object bytes = manifest artifact size_bytes' },
      ],
      terms: [
        { term: 'Gold artifact', meaning: 'Immutable Parquet partition của canonical candidate dataset.' },
        { term: 'Manifest SHA', meaning: 'SHA-256 tính lại trên manifest bytes và đối chiếu durable batch ledger.' },
        { term: 'Content SHA', meaning: 'Digest nội dung logical được writer khai báo trong manifest.' },
        { term: 'Parquet SHA', meaning: 'Digest byte-level của Parquet artifact được writer khai báo.' },
        { term: 'Bytes/row', meaning: 'Mật độ lưu trữ quan sát được; không phải compression ratio khi chưa có logical input bytes.' },
      ],
    },
    'gold-index': {
      formulas: [
        { label: 'Index coverage', expression: 'actual queryable candidate rows / expected manifest rows × 100%' },
        { label: 'Five-way parity', expression: 'batch indexed = manifest expected = registry indexed = marker indexed = actual rows' },
        { label: 'LC sample density', expression: 'checksum-verified Light Curve sample rows / candidate rows' },
      ],
      terms: [
        { term: 'Snapshot registry', meaning: 'ClickHouse record ghim manifest SHA, expected rows, indexed rows và index status.' },
        { term: 'Actual queryable rows', meaning: 'Số row được count trực tiếp từ candidate_features cho đúng snapshot ID.' },
        { term: 'Projection marker', meaning: 'Immutable MinIO record mô tả ClickHouse projection đã hoàn tất cho snapshot.' },
        { term: 'LC plot samples', meaning: 'Exact time/flux samples đọc từ Silver checksum-verified để tăng tốc visualization.' },
        { term: 'Training cohort', meaning: 'Reviewable derived overlay; không sửa immutable Candidate Gold.' },
      ],
    },
    'gold-commit': {
      formulas: [
        { label: 'Immutable commit validity', expression: 'valid = manifest COMMITTED ∧ SHA/fingerprint bound ∧ artifacts intact ∧ row parity ∧ projection READY' },
        { label: 'Row reconciliation', expression: 'batch candidate_rows = manifest row_count = queryable projection rows' },
        { label: 'Current activation', expression: 'active = pointer(snapshot, fingerprint, manifest key, manifest SHA) matches snapshot' },
      ],
      terms: [
        { term: 'Immutable snapshot', meaning: 'Manifest và artifact đã commit theo snapshot ID; không thay đổi khi một snapshot mới trở thành current.' },
        { term: 'End-to-end verified', meaning: 'Toàn bộ storage, provenance, row accounting và analytical projection cùng vượt qua integrity gate.' },
        { term: 'Current pointer', meaning: 'Con trỏ activation có thể chuyển sang snapshot mới; HISTORY không có nghĩa snapshot cũ bị lỗi.' },
        { term: 'Fingerprint binding', meaning: 'Snapshot ID, fingerprint và manifest key trong manifest khớp durable batch ledger.' },
      ],
    },
  };
  if (references[hop.id]) return references[hop.id];
  return {
    formulas: hop.formula ? [{ label: 'Phép tính chính', expression: hop.formula }] : [],
    terms: [
      { term: 'Input', meaning: hop.input },
      { term: 'Output', meaning: hop.output },
    ],
  };
}


function ScientificMethodCard({ hop }: { hop: Hop }): JSX.Element {
  const reference = scientificReference(hop);
  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3 shadow-xs dark:border-border/60 dark:bg-muted/15">
      <span className="flex items-center gap-1.5 text-[10px] font-bold uppercase tracking-wider text-muted-foreground">
        <Calculator className="size-3.5 text-primary" /> Phương pháp tính & thuật ngữ
      </span>
      {reference.formulas.length > 0 && (
        <div className="space-y-1.5">
          {reference.formulas.map((formula) => (
            <div key={formula.label} className="rounded border border-border/70 bg-muted/30 p-2 dark:bg-background">
              <p className="text-[9px] uppercase font-medium text-muted-foreground">{formula.label}</p>
              <p className="mt-0.5 break-words font-mono text-[11px] font-semibold leading-relaxed text-primary">
                {formula.expression}
              </p>
            </div>
          ))}
        </div>
      )}
      <dl className="divide-y divide-border/60 rounded border border-border/70 bg-card overflow-hidden dark:bg-background">
        {reference.terms.map((item) => (
          <div key={item.term} className="px-2.5 py-1.5">
            <dt className="break-words font-mono text-[10px] font-semibold text-foreground">{item.term}</dt>
            <dd className="mt-0.5 break-words text-[10px] leading-4 text-muted-foreground">{item.meaning}</dd>
          </div>
        ))}
      </dl>
    </div>
  );
}

export function HopDetailDrawer({
  selectedHop,
  ticketID,
  onClose,
  mode = 'batch',
  totalFiles = 0,
  portalContainer,
}: {
  selectedHop: Hop | undefined;
  ticketID?: string;
  onClose: () => void;
  mode?: 'stream' | 'batch';
  totalFiles?: number;
  portalContainer?: HTMLElement | null;
}): JSX.Element {
  const [liveHopData, setLiveHopData] = useState<Partial<Hop> | null>(null);
  const [isLoadingHop, setIsLoadingHop] = useState<boolean>(false);

  useEffect(() => {
    if (!selectedHop) {
      setLiveHopData(null);
      return;
    }

    let cancelled = false;
    setIsLoadingHop(true);
    const searchParams = new URLSearchParams();
    if (ticketID) searchParams.set('ticket_id', ticketID);
    const query = searchParams.toString() ? `?${searchParams.toString()}` : '';

    apiFetch<Partial<Hop>>(`/v1/dag/hops/${encodeURIComponent(selectedHop.id)}${query}`)
      .then((data) => {
        if (!cancelled && data) {
          setLiveHopData(data);
        }
      })
      .catch((err) => {
        console.warn(`Failed to fetch on-demand metrics for hop ${selectedHop.id}:`, err);
      })
      .finally(() => {
        if (!cancelled) setIsLoadingHop(false);
      });

    return () => {
      cancelled = true;
    };
  }, [selectedHop?.id, ticketID]);

  const mergedMetrics = selectedHop ? {
    ...selectedHop.metrics,
    ...liveHopData?.metrics,
  } : undefined;

  const mergedTelemetry = selectedHop ? {
    ...selectedHop.telemetry,
    ...liveHopData?.telemetry,
  } : undefined;

  return (
    <Drawer
      open={selectedHop !== undefined}
      onOpenChange={(open) => {
        if (!open) onClose();
      }}
    >
      <DrawerContent portalContainer={portalContainer} className="h-[84svh] !max-h-[84svh] border-t-2 border-primary/40">
        <DrawerHeader className="border-b border-border px-4 py-3 text-left md:px-6">
          <div className="flex w-full items-center justify-between gap-4">
            <div>
              <DrawerTitle className="text-base font-bold flex items-center gap-2">
                <Workflow className="size-4 text-primary" />
                {selectedHop ? `Bước ${selectedHop.stepNumber}: ${selectedHop.label}` : 'Chi tiết bước xử lý'}
                <Badge variant="secondary" className="ml-2 font-mono text-[10px] uppercase">
                  {mode === 'stream' ? 'Stream mode' : 'Batch mode'}
                </Badge>
              </DrawerTitle>
              <DrawerDescription className="text-xs mt-0.5">
                {selectedHop?.description ?? 'Đặc tả hợp đồng và dữ liệu đầu vào/đầu ra.'}
              </DrawerDescription>
            </div>
            <DrawerClose asChild>
              <Button variant="ghost" size="icon-sm">
                <X className="size-4" />
                <span className="sr-only">Close</span>
              </Button>
            </DrawerClose>
          </div>
        </DrawerHeader>

        <div className="min-h-0 flex-1 overflow-y-auto p-3 text-xs md:p-4">
          {selectedHop ? (
            <div className="grid min-h-full items-start gap-3 xl:grid-cols-[minmax(270px,0.22fr)_minmax(0,0.78fr)]">
              {/* Left Column: scientific goal, formulas and terminology */}
              <div className="space-y-2">
                {/* Input & Output Cards */}
                <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-1">
                  <div className="bg-card p-2.5 rounded-lg border border-border shadow-xs dark:bg-muted/20 dark:border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Đầu vào (Input)
                    </span>
                    <span className="font-semibold text-foreground text-xs break-words whitespace-normal block mt-0.5" title={selectedHop.input}>
                      {selectedHop.input}
                    </span>
                  </div>
                  <div className="bg-card p-2.5 rounded-lg border border-border shadow-xs dark:bg-muted/20 dark:border-border/50">
                    <span className="text-muted-foreground block text-[10px] font-semibold uppercase">
                      Đầu ra (Output)
                    </span>
                    <span className="font-semibold text-foreground text-xs break-words whitespace-normal block mt-0.5" title={selectedHop.output}>
                      {selectedHop.output}
                    </span>
                  </div>
                </div>

                {/* Astronomy Goal */}
                <div className="bg-card p-3 rounded-lg border border-border shadow-xs dark:bg-muted/15 dark:border-border/60 space-y-2">
                  <span className="text-muted-foreground uppercase tracking-wider text-[10px] font-bold flex items-center gap-1.5">
                    <FileText className="size-3.5 text-primary" /> Mục tiêu Khoa học Thiên văn
                  </span>
                  <p className="text-xs font-medium text-foreground leading-relaxed">
                    {selectedHop.astronomyGoal}
                  </p>
                </div>

                <ScientificMethodCard hop={selectedHop} />
              </div>

              {/* Right Column: large scientific visualizer */}
              <div className="min-h-[480px] bg-card p-3 rounded-lg border border-border shadow-xs dark:bg-muted/15 dark:border-border/80 space-y-3">
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-border/40 pb-2">
                  <div className="flex items-center gap-2 text-foreground font-semibold text-xs">
                    <Activity className="size-4 text-primary" />
                    <span>{selectedHop.shortTitle}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    {isLoadingHop && <Loader2 className="size-3 animate-spin text-primary" />}
                    <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-muted-foreground">
                      {ticketID ? `Aggregated for ${ticketID}` : 'Observed evidence only'}
                    </span>
                  </div>
                </div>

                {renderHopChart(selectedHop.id, mode, totalFiles, mergedMetrics, mergedTelemetry, selectedHop.scatter_points, selectedHop.tpf_transform_points, selectedHop.materialization_points, selectedHop.encode_failures, selectedHop.silver_failures, selectedHop.checkpoint_points, selectedHop.details, selectedHop.lc_feature_evidence, selectedHop.bls_search_evidence, selectedHop.tpf_spatial_evidence, selectedHop.candidate_assembly_evidence, selectedHop.gold_materialization_evidence, selectedHop.gold_projection_evidence, selectedHop.gold_commit_evidence)}
              </div>
            </div>
          ) : (
            <div className="py-12 text-center text-muted-foreground">Chọn một node để xem chi tiết.</div>
          )}
        </div>
      </DrawerContent>
    </Drawer>
  );
}
