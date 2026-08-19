import { useCallback, useEffect, useMemo, useState } from 'react';
import type { JSX } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronLeft,
  ChevronRight,
  Layers,
  RefreshCw,
  Search,
  Sparkles,
} from 'lucide-react';

import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';
import { Input } from '@/components/ui/input';
import { Progress } from '@/components/ui/progress';
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { apiFetch } from '@/lib/api';

type StorageObject = {
  key: string;
  size_bytes: number;
  etag?: string;
  last_modified: string;
};

type StorageListing = {
  bucket: string;
  prefix: string;
  page: number;
  page_size: number;
  total: number;
  total_bytes: number;
  truncated: boolean;
  objects: StorageObject[];
};

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value <= 0) return '0 B';
  if (value < 1024) return `${value} B`;
  if (value < 1024 ** 2) return `${(value / 1024).toFixed(1)} KB`;
  if (value < 1024 ** 3) return `${(value / 1024 ** 2).toFixed(1)} MB`;
  return `${(value / 1024 ** 3).toFixed(2)} GB`;
}

function formatDate(value?: string): string {
  if (!value) return '—';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : date.toLocaleString();
}

const goldFeatureCatalog = [
  {
    name: 'bls_period',
    category: 'Orbital Kinematics',
    unit: 'Days',
    dtype: 'Float64',
    description: 'Chu kỳ quỹ đạo phát hiện qua thuật toán Box Least Squares (BLS).',
  },
  {
    name: 'bls_depth',
    category: 'Photometry',
    unit: 'Fraction (ΔF/F)',
    dtype: 'Float64',
    description: 'Độ sụt giảm cường độ sáng cực đại khi hành tinh đi qua đĩa sao.',
  },
  {
    name: 'bls_duration',
    category: 'Orbital Kinematics',
    unit: 'Days',
    dtype: 'Float64',
    description: 'Tổng thời lượng một pha quá cảnh (Transit Duration).',
  },
  {
    name: 'bls_power',
    category: 'Statistical Signal',
    unit: 'S/N Peak',
    dtype: 'Float64',
    description: 'Tỷ số tín hiệu trên nhiễu của đỉnh chu kỳ BLS Periodogram.',
  },
  {
    name: 'transit_deficit_sum',
    category: 'Photometry',
    unit: 'Flux Integral',
    dtype: 'Float64',
    description: 'Tích phân diện tích phần sáng bị che khuất trong pha quá cảnh.',
  },
  {
    name: 'flux_mean / flux_rms',
    category: 'Lightcurve Stats',
    unit: 'Normalized e-/s',
    dtype: 'Float64',
    description: 'Giá trị cường độ sáng trung bình và độ lệch quân phương RMS.',
  },
  {
    name: 'flux_amplitude',
    category: 'Lightcurve Stats',
    unit: 'ΔFlux Peak-to-Peak',
    dtype: 'Float64',
    description: 'Biên độ dao động ánh sáng đỉnh-đáy của ngôi sao.',
  },
  {
    name: 'pixel_mad_median',
    category: 'Target Pixel (TPF)',
    unit: 'MAD Pixels',
    dtype: 'Float64',
    description: 'Độ biến thiên không gian trung vị giữa các điểm ảnh TPF (Loại trừ nhiễu nền).',
  },
  {
    name: 'stellar_radius',
    category: 'TIC Stellar',
    unit: 'R_☉ (Solar)',
    dtype: 'Float32',
    description: 'Bán kính sao chủ đối chiếu từ TESS Input Catalog.',
  },
  {
    name: 'stellar_mass',
    category: 'TIC Stellar',
    unit: 'M_☉ (Solar)',
    dtype: 'Float32',
    description: 'Khối lượng sao chủ đối chiếu từ TESS Input Catalog.',
  },
  {
    name: 'teff',
    category: 'TIC Stellar',
    unit: 'Kelvin (K)',
    dtype: 'Float32',
    description: 'Nhiệt độ hiệu dụng bề mặt của ngôi sao chủ.',
  },
  {
    name: 'tmag',
    category: 'TIC Stellar',
    unit: 'TESS Magnitude',
    dtype: 'Float32',
    description: 'Cấp sao biểu kiến trong dải phổ của kính thiên văn TESS.',
  },
  {
    name: 'matched_toi_id / matched_tce_id',
    category: 'Ground Truth Labels',
    unit: 'Catalog ID',
    dtype: 'String',
    description: 'Nhãn đối chiếu ứng viên TESS Object of Interest / TCE chính thức từ NASA.',
  },
];

export default function DatasetsPage(): JSX.Element {
  const [activeTab, setActiveTab] = useState<'bronze' | 'silver' | 'gold'>('gold');

  // Storage states for Bronze & Silver
  const [bronzeData, setBronzeData] = useState<StorageListing | null>(null);
  const [silverData, setSilverData] = useState<StorageListing | null>(null);
  const [goldData, setGoldData] = useState<StorageListing | null>(null);

  const [currentPrefix, setCurrentPrefix] = useState('gold/');
  const [searchPrefix, setSearchPrefix] = useState('');
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const loadTier = useCallback(async (tierPrefix: string, targetPage: number) => {
    setLoading(true);
    setError(null);
    try {
      const data = await apiFetch<StorageListing>(
        `/v1/storage?prefix=${encodeURIComponent(tierPrefix)}&page=${targetPage}&limit=${pageSize}`,
      );
      if (tierPrefix.startsWith('bronze')) setBronzeData(data);
      else if (tierPrefix.startsWith('silver')) setSilverData(data);
      else if (tierPrefix.startsWith('gold')) setGoldData(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Không thể tải dữ liệu Storage');
    } finally {
      setLoading(false);
    }
  }, []);

  // Initial load all 3 tiers concurrently with robust error isolation
  useEffect(() => {
    let mounted = true;
    setLoading(true);
    setError(null);

    Promise.allSettled([
      apiFetch<StorageListing>(`/v1/storage?prefix=bronze/&page=1&limit=${pageSize}`),
      apiFetch<StorageListing>(`/v1/storage?prefix=silver/&page=1&limit=${pageSize}`),
      apiFetch<StorageListing>(`/v1/storage?prefix=gold/&page=1&limit=${pageSize}`),
    ]).then(([bronzeRes, silverRes, goldRes]) => {
      if (!mounted) return;
      if (bronzeRes.status === 'fulfilled' && bronzeRes.value) setBronzeData(bronzeRes.value);
      if (silverRes.status === 'fulfilled' && silverRes.value) setSilverData(silverRes.value);
      if (goldRes.status === 'fulfilled' && goldRes.value) setGoldData(goldRes.value);
      setLoading(false);
    });

    return () => {
      mounted = false;
    };
  }, []);

  const handleTabChange = (tab: string) => {
    const nextTab = tab as 'bronze' | 'silver' | 'gold';
    setActiveTab(nextTab);
    setPage(1);
    setSearchPrefix('');
    if (nextTab === 'bronze') setCurrentPrefix('bronze/');
    else if (nextTab === 'silver') setCurrentPrefix('silver/');
    else if (nextTab === 'gold') setCurrentPrefix('gold/');
    void loadTier(`${nextTab}/`, 1);
  };

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setPage(1);
    const target = searchPrefix.trim() ? searchPrefix.trim() : `${activeTab}/`;
    setCurrentPrefix(target);
    void loadTier(target, 1);
  };

  const handlePageChange = (newPage: number) => {
    setPage(newPage);
    void loadTier(currentPrefix, newPage);
  };

  const activeListing = useMemo(() => {
    if (activeTab === 'bronze') return bronzeData;
    if (activeTab === 'silver') return silverData;
    return goldData;
  }, [activeTab, bronzeData, silverData, goldData]);

  const totalPages = useMemo(() => {
    if (!activeListing || activeListing.total <= 0) return 1;
    return Math.max(1, Math.ceil(activeListing.total / pageSize));
  }, [activeListing]);

  // Rolling storage budget for Bronze (50 GiB max policy)
  const bronzeBufferCapacity = 50 * 1024 * 1024 * 1024;
  const bronzeUsedPercent = Math.min(
    100,
    Math.round(((bronzeData?.total_bytes ?? 0) / bronzeBufferCapacity) * 100),
  );

  return (
    <div className="space-y-6">
      {/* Page Header */}
      <div className="flex flex-col justify-between gap-4 xl:flex-row xl:items-end">
        <div>
          <div className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-[0.12em] text-muted-foreground">
            <Layers className="size-4 text-primary" aria-hidden="true" />
            Medallion Data Lakehouse Architecture
          </div>
          <h2 className="font-heading text-2xl font-semibold tracking-tight md:text-3xl">
            Datasets & Feature Store
          </h2>
          <p className="mt-1 max-w-3xl text-sm text-muted-foreground">
            Quản lý tập trung 3 phân lớp dữ liệu (Bronze Thô · Silver Tiền xử lý · Gold Đặc trưng ML) trên kho lưu trữ MinIO S3.
          </p>
        </div>
        <Button
          variant="outline"
          size="sm"
          onClick={() => void loadTier(currentPrefix, page)}
          disabled={loading}
        >
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} />
          Refresh Storage
        </Button>
      </div>

      {error && (
        <div className="flex items-center gap-2 border border-destructive/40 bg-destructive/10 p-4 text-sm text-destructive">
          <AlertCircle className="size-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {/* Lakehouse Overview Summary Cards */}
      <div className="grid gap-4 md:grid-cols-3">
        {/* Bronze Card */}
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'bronze' ? 'border-primary/80 bg-primary/5' : 'hover:border-border'
            }`}
          onClick={() => handleTabChange('bronze')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🥉</span>
                <CardTitle className="text-sm font-semibold">Bronze Layer</CardTitle>
              </div>
              <Badge variant="outline" className="font-mono text-[11px]">
                Raw FITS
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Dữ liệu thô tải từ NASA MAST. Lưu trữ xoay vòng ~50 GiB.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-2xl font-bold">
                {bronzeData?.total ?? 0}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {formatBytes(bronzeData?.total_bytes ?? 0)}
              </span>
            </div>
            <div className="mt-3 space-y-1">
              <div className="flex justify-between text-[11px] text-muted-foreground">
                <span>Vùng đệm 50 GiB</span>
                <span>{bronzeUsedPercent}%</span>
              </div>
              <Progress value={bronzeUsedPercent} className="h-1.5" />
            </div>
          </CardContent>
        </Card>

        {/* Silver Card */}
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'silver' ? 'border-primary/80 bg-primary/5' : 'hover:border-border'
            }`}
          onClick={() => handleTabChange('silver')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🥈</span>
                <CardTitle className="text-sm font-semibold">Silver Layer</CardTitle>
              </div>
              <Badge variant="outline" className="font-mono text-[11px]">
                Parquet Series
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Đường cong ánh sáng & TPF đã được làm sạch, chuẩn hóa.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-2xl font-bold">
                {silverData?.total ?? 0}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {formatBytes(silverData?.total_bytes ?? 0)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-emerald-400">
              <CheckCircle2 className="size-3.5" />
              <span>Lineage & Quality Verification</span>
            </div>
          </CardContent>
        </Card>

        {/* Gold Card */}
        <Card
          className={`cursor-pointer transition-colors ${activeTab === 'gold' ? 'border-primary/80 bg-primary/5' : 'hover:border-border'
            }`}
          onClick={() => handleTabChange('gold')}
        >
          <CardHeader className="pb-3">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <span className="text-xl">🥇</span>
                <CardTitle className="text-sm font-semibold">Gold Feature Store</CardTitle>
              </div>
              <Badge variant="outline" className="font-mono text-[11px] bg-amber-500/10 text-amber-300 border-amber-500/30">
                ML Ready
              </Badge>
            </div>
            <CardDescription className="text-xs">
              Snapshots đặc trưng toán học & vật lý thiên văn cho PyTorch/ONNX.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex justify-between items-baseline">
              <span className="font-mono text-2xl font-bold">
                {goldData?.total ?? 0}
              </span>
              <span className="text-xs font-mono text-muted-foreground">
                {formatBytes(goldData?.total_bytes ?? 0)}
              </span>
            </div>
            <div className="mt-3 flex items-center gap-1.5 text-xs text-amber-300">
              <Sparkles className="size-3.5" />
              <span>16+ Derived Features & Snapshots</span>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Main Tabs Explorer */}
      <Tabs value={activeTab} onValueChange={handleTabChange} className="space-y-6">
        <TabsList className="grid w-full grid-cols-3 max-w-md">
          <TabsTrigger value="gold" className="gap-2">
            🥇 Gold Features
          </TabsTrigger>
          <TabsTrigger value="silver" className="gap-2">
            🥈 Silver Cleaned
          </TabsTrigger>
          <TabsTrigger value="bronze" className="gap-2">
            🥉 Bronze Raw FITS
          </TabsTrigger>
        </TabsList>

        {/* ========================================================================= */}
        {/* GOLD LAYER TAB */}
        {/* ========================================================================= */}
        <TabsContent value="gold" className="space-y-6">
          {/* Active Champion Snapshot Banner */}
          <Card className="border-amber-500/30 bg-amber-500/5">
            <CardHeader className="pb-3">
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
                <div className="flex items-center gap-2">
                  <Sparkles className="size-5 text-amber-400" />
                  <div>
                    <CardTitle className="text-base font-semibold">
                      Current Gold Snapshot Pointer
                    </CardTitle>
                    <CardDescription className="text-xs">
                      Con trỏ snapshot chuẩn bất biến đang được cung cấp cho GPU ML Worker huấn luyện & suy luận.
                    </CardDescription>
                  </div>
                </div>
                <Badge className="bg-amber-500 text-black font-semibold text-xs">
                  gold/current/CANDIDATE.json
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-4 text-xs">
                <div className="rounded border border-amber-500/20 bg-background/50 p-3">
                  <span className="text-muted-foreground">ML Task Mục tiêu:</span>
                  <p className="mt-1 font-mono font-medium text-foreground">candidate_vetting</p>
                </div>
                <div className="rounded border border-amber-500/20 bg-background/50 p-3">
                  <span className="text-muted-foreground">Định dạng tệp:</span>
                  <p className="mt-1 font-mono font-medium text-foreground">features.parquet (DuckDB)</p>
                </div>
                <div className="rounded border border-amber-500/20 bg-background/50 p-3">
                  <span className="text-muted-foreground">Phân chia tập dữ liệu:</span>
                  <p className="mt-1 font-mono font-medium text-foreground">Train (70%) · Val (15%) · Test (15%)</p>
                </div>
                <div className="rounded border border-amber-500/20 bg-background/50 p-3">
                  <span className="text-muted-foreground">Tự động hóa:</span>
                  <p className="mt-1 font-mono font-medium text-emerald-400">python-gold-builder (Active)</p>
                </div>
              </div>
            </CardContent>
          </Card>

          {/* Feature Catalog Dictionary */}
          <Card>
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Từ điển Đặc trưng Thiên văn (Gold Feature Store Schema)
                  </CardTitle>
                  <CardDescription>
                    Danh mục các đặc trưng toán học và vật lý được trích xuất từ chuỗi thời gian ánh sáng Silver.
                  </CardDescription>
                </div>
                <Badge variant="outline" className="font-mono">
                  {goldFeatureCatalog.length} Features
                </Badge>
              </div>
            </CardHeader>
            <CardContent>
              <div className="overflow-x-auto">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-[200px]">Tên đặc trưng (Column)</TableHead>
                      <TableHead>Nhóm</TableHead>
                      <TableHead>Kiểu dữ liệu</TableHead>
                      <TableHead>Đơn vị</TableHead>
                      <TableHead>Mô tả giải tích</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {goldFeatureCatalog.map((feat) => (
                      <TableRow key={feat.name}>
                        <TableCell className="font-mono text-xs font-semibold text-primary">
                          {feat.name}
                        </TableCell>
                        <TableCell>
                          <Badge variant="secondary" className="text-[10px]">
                            {feat.category}
                          </Badge>
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {feat.dtype}
                        </TableCell>
                        <TableCell className="font-mono text-xs text-muted-foreground">
                          {feat.unit}
                        </TableCell>
                        <TableCell className="text-xs text-muted-foreground">
                          {feat.description}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </CardContent>
          </Card>

          {/* Gold Storage Objects Browser */}
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Tệp tin trong MinIO `gold/`
                  </CardTitle>
                  <CardDescription>
                    Duyệt các snapshot manifest, parquet partitions và con trỏ hiện tại.
                  </CardDescription>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                  <Input
                    placeholder="Prefix (ví dụ: gold/snapshots/)..."
                    className="h-8 text-xs w-48 sm:w-64"
                    value={searchPrefix}
                    onChange={(e) => setSearchPrefix(e.target.value)}
                  />
                  <Button type="submit" size="sm" variant="secondary" className="h-8">
                    <Search className="size-3.5" />
                  </Button>
                </form>
              </div>
            </CardHeader>
            <CardContent>
              {renderObjectTable(goldData, loading, page, totalPages, handlePageChange)}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* SILVER LAYER TAB */}
        {/* ========================================================================= */}
        <TabsContent value="silver" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Tệp tin Chuẩn hóa trong MinIO `silver/`
                  </CardTitle>
                  <CardDescription>
                    Dữ liệu chuỗi thời gian Lightcurve và Target Pixel Files đã được lọc nhiễu và lưu dạng Parquet.
                  </CardDescription>
                </div>
                <div className="flex items-center gap-2">
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setCurrentPrefix('silver/tess/lightcurves/');
                      setSearchPrefix('silver/tess/lightcurves/');
                      void loadTier('silver/tess/lightcurves/', 1);
                    }}
                  >
                    Lightcurves Parquet
                  </Button>
                  <Button
                    size="sm"
                    variant="outline"
                    className="h-8 text-xs"
                    onClick={() => {
                      setCurrentPrefix('silver/tess/tpf/');
                      setSearchPrefix('silver/tess/tpf/');
                      void loadTier('silver/tess/tpf/', 1);
                    }}
                  >
                    TPF Parquet
                  </Button>
                </div>
              </div>
            </CardHeader>
            <CardContent>
              {renderObjectTable(silverData, loading, page, totalPages, handlePageChange)}
            </CardContent>
          </Card>
        </TabsContent>

        {/* ========================================================================= */}
        {/* BRONZE LAYER TAB */}
        {/* ========================================================================= */}
        <TabsContent value="bronze" className="space-y-6">
          <Card>
            <CardHeader>
              <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
                <div>
                  <CardTitle className="text-base font-semibold">
                    Tệp FITS Thô trong MinIO `bronze/`
                  </CardTitle>
                  <CardDescription>
                    Kho lưu trữ đối tượng bất biến thô tải trực tiếp từ NASA MAST theo từng Sector.
                  </CardDescription>
                </div>
                <form onSubmit={handleSearch} className="flex gap-2">
                  <Input
                    placeholder="Prefix (ví dụ: bronze/tess/)..."
                    className="h-8 text-xs w-48 sm:w-64"
                    value={searchPrefix}
                    onChange={(e) => setSearchPrefix(e.target.value)}
                  />
                  <Button type="submit" size="sm" variant="secondary" className="h-8">
                    <Search className="size-3.5" />
                  </Button>
                </form>
              </div>
            </CardHeader>
            <CardContent>
              {renderObjectTable(bronzeData, loading, page, totalPages, handlePageChange)}
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}

function renderObjectTable(
  data: StorageListing | null,
  loading: boolean,
  page: number,
  totalPages: number,
  onPageChange: (newPage: number) => void,
) {
  const objects = data?.objects ?? [];

  return (
    <div className="space-y-4">
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Object Key (S3 Path)</TableHead>
              <TableHead className="w-[120px]">Kích thước</TableHead>
              <TableHead className="w-[160px]">ETag / Hash</TableHead>
              <TableHead className="w-[200px]">Cập nhật lần cuối</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {loading ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  <RefreshCw className="size-4 animate-spin inline mr-2" />
                  Đang truy vấn MinIO S3...
                </TableCell>
              </TableRow>
            ) : objects.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="h-32 text-center text-sm text-muted-foreground">
                  Không có đối tượng nào trong prefix này.
                </TableCell>
              </TableRow>
            ) : (
              objects.map((obj) => (
                <TableRow key={obj.key}>
                  <TableCell className="font-mono text-xs font-medium text-foreground truncate max-w-[400px]" title={obj.key}>
                    {obj.key}
                  </TableCell>
                  <TableCell className="font-mono text-xs">
                    {formatBytes(obj.size_bytes)}
                  </TableCell>
                  <TableCell className="font-mono text-[11px] text-muted-foreground truncate max-w-[140px]" title={obj.etag}>
                    {obj.etag ? obj.etag.replace(/"/g, '') : '—'}
                  </TableCell>
                  <TableCell className="text-xs text-muted-foreground">
                    {formatDate(obj.last_modified)}
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      {/* Pagination Controls */}
      <div className="flex items-center justify-between border-t border-border/60 pt-3 text-xs text-muted-foreground">
        <span>
          Tổng cộng: <strong className="text-foreground">{data?.total ?? 0}</strong> đối tượng (
          {formatBytes(data?.total_bytes ?? 0)})
        </span>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={page <= 1 || loading}
            onClick={() => onPageChange(page - 1)}
          >
            <ChevronLeft className="size-3.5" />
          </Button>
          <span className="font-mono">
            Trang {page} / {totalPages}
          </span>
          <Button
            variant="outline"
            size="sm"
            className="h-7 w-7 p-0"
            disabled={page >= totalPages || loading}
            onClick={() => onPageChange(page + 1)}
          >
            <ChevronRight className="size-3.5" />
          </Button>
        </div>
      </div>
    </div>
  );
}
