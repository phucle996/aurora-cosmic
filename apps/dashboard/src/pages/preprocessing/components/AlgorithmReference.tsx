import type { JSX } from 'react';
import { Database, Orbit, Sparkles, Wand2 } from 'lucide-react';

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from '@/components/ui/card';

export function AlgorithmReference(): JSX.Element {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <Card className="border-border/80">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Wand2 className="size-4 text-primary" />
            1. Non-linear Spline Detrending (Khử Xu Hướng Sao)
          </CardTitle>
          <CardDescription className="text-xs">
            Loại bỏ biến quang chu kỳ dài của sao mẹ và độ trôi quang sai nhiệt của kính thiên văn TESS.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
          <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
            F_norm(t) = F_raw(t) / S_spline(t, window=0.75d, step=0.1d)
          </div>
          <p className="text-muted-foreground">
            Sử dụng thuật toán <strong>Savitzky-Golay / Cubic Spline with iterative outlier masking</strong>. 
            Bộ lọc này chia nhỏ chuỗi thời gian thành các cửa sổ 0.75 ngày, khớp đa thức bậc 2 để tìm hàm nền S(t), 
            sau đó chia thông lượng thực tế cho S(t) để đưa đường cong về giá trị trung bình 1.0.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Sparkles className="size-4 text-purple-400" />
            2. 5σ Outlier &amp; Flare Rejection (Lọc Nhiễu Điểm Dị Biệt)
          </CardTitle>
          <CardDescription className="text-xs">
            Loại trừ các điểm đo bị nhiễu tia vũ trụ (Cosmic Ray Hits) hoặc hiện tượng sao lóe sáng (Stellar Flares).
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
          <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
            | F_norm(t) - Median(F_norm) | &lt; 5 * 1.4826 * MAD(F_norm)
          </div>
          <p className="text-muted-foreground">
            Thay vì dùng phương sai chuẩn thông thường (dễ bị ảnh hưởng bởi điểm ngoại lai), hệ thống sử dụng 
            <strong> Median Absolute Deviation (MAD)</strong> để tính độ lệch chuẩn bền vững (Robust Sigma). 
            Mọi điểm lệch quá 5σ đều được đánh dấu cờ loại trừ.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Orbit className="size-4 text-emerald-400" />
            3. Box Least Squares (BLS) Transit Period Search
          </CardTitle>
          <CardDescription className="text-xs">
            Tìm kiếm chu kỳ quỹ đạo P và thời điểm quá cảnh T₀ của hành tinh.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
          <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
            BLS_Power(P, T₀, q) = [ s² / (r * (1 - r)) ]_max
          </div>
          <p className="text-muted-foreground">
            Thuật toán quét qua dải chu kỳ từ 0.5 đến 30 ngày. Với mỗi chu kỳ, dữ liệu được gập pha thành dạng hình hộp (Box-like Dip). 
            Đỉnh phổ BLS cao nhất tương ứng với chu kỳ quỹ đạo thực tế của ngoại hành tinh.
          </p>
        </CardContent>
      </Card>

      <Card className="border-border/80">
        <CardHeader className="pb-3 border-b border-border/60">
          <CardTitle className="text-base font-semibold flex items-center gap-2">
            <Database className="size-4 text-sky-400" />
            4. Columnar Silver Parquet Encoding
          </CardTitle>
          <CardDescription className="text-xs">
            Lưu trữ dạng cột tối ưu hóa truy vấn phân tích khoa học và nạp mô hình ML siêu tốc.
          </CardDescription>
        </CardHeader>
        <CardContent className="p-4 space-y-3 text-xs leading-relaxed">
          <div className="bg-muted/20 p-3 rounded font-mono text-xs border border-border/50">
            Parquet Schema: [time_bjd: float64, flux_norm: float32, flux_err: float32, phase: float32, quality: uint32]
          </div>
          <p className="text-muted-foreground">
            Định dạng nén <strong>Snappy Compression + Dictionary Encoding</strong> giúp giảm dung lượng đến 85% so với FITS gốc, 
            đồng thời cho phép nạp trực tiếp vào DuckDB/ClickHouse hoặc PyTorch DataLoader mà không cần giải mã trung gian.
          </p>
        </CardContent>
      </Card>
    </div>
  );
}
