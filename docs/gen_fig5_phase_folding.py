import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits

# Cấu hình phong cách đồ họa khoa học Light Mode
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#1E293B'
plt.rcParams['axes.linewidth'] = 1.0
plt.rcParams['figure.facecolor'] = '#FFFFFF'
plt.rcParams['axes.facecolor'] = '#FFFFFF'

# 1. Đọc dữ liệu FITS thực tế NASA TESS (WASP-126 b / TIC 25155310)
fits_path = '/home/phucle/.cache/lightkurve/mastDownload/TESS/tess2018206045859-s0001-0000000025155310-0120-s/tess2018206045859-s0001-0000000025155310-0120-s_lc.fits'
with fits.open(fits_path) as hdul:
    data = hdul[1].data
    raw_time = np.array(data['TIME'], dtype=np.float64)
    raw_pdcsap = np.array(data['PDCSAP_FLUX'], dtype=np.float64)
    raw_qual = np.array(data['QUALITY'], dtype=np.int32)

# Tiền xử lý tầng Silver: Lọc QUALITY == 0, loại bỏ NaN, chuẩn hóa trung vị
mask = np.isfinite(raw_time) & np.isfinite(raw_pdcsap) & (raw_qual == 0)
time = raw_time[mask]
flux_pdcsap = raw_pdcsap[mask]
norm_flux = (flux_pdcsap / np.nanmedian(flux_pdcsap)) - 1.0

# Lọc ngoại lai cực hạn
mad = np.median(np.abs(norm_flux - np.median(norm_flux)))
robust_sigma = 1.4826 * mad
clip_mask = (norm_flux < 5.0 * robust_sigma) & (norm_flux > -0.025)
time_clean = time[clip_mask]
flux_clean = norm_flux[clip_mask]

# 2. Tham số thiên văn của hành tinh WASP-126 b
period = 3.2888  # Chu kỳ quỹ đạo (ngày)
t0 = 1327.352    # Tâm quá cảnh đầu tiên (BTJD)
duration = 0.155 # Độ dài quá cảnh (~3.7 giờ)

# 3. Tính toán Phase Folding
# Phase phi trong khoảng [-0.5, 0.5]
phase = ((time_clean - t0 + 0.5 * period) % period) - 0.5 * period

# Gom nhóm (Binning) dữ liệu gấp pha để làm nổi bật hình thái
n_bins = 150
bin_edges = np.linspace(-0.5 * period, 0.5 * period, n_bins + 1)
bin_centers = 0.5 * (bin_edges[:-1] + bin_edges[1:])
binned_flux = np.full(n_bins, np.nan)
binned_err = np.full(n_bins, np.nan)

for i in range(n_bins):
    in_bin = (phase >= bin_edges[i]) & (phase < bin_edges[i+1])
    if np.sum(in_bin) > 0:
        binned_flux[i] = np.nanmedian(flux_clean[in_bin])
        binned_err[i] = np.nanstd(flux_clean[in_bin]) / np.sqrt(np.sum(in_bin))

# 4. Vẽ biểu đồ 2 Panel
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 8.5), dpi=300)

# ==================== PANEL 1: FULL LIGHT CURVE ====================
ax1.plot(time_clean, flux_clean, '.', color='#2563EB', markersize=1.8, alpha=0.55, rasterized=True,
         label='Chuỗi đo thông lượng chuẩn hóa (Cleaned Silver Flux)')
ax1.axhline(0.0, color='#64748B', linestyle='--', linewidth=1.0, label='Đường nền chuẩn hóa (Baseline = 0.0)')

# Đánh dấu các nhịp quá cảnh
transit_times = [t0 + k * period for k in range(9) if np.min(time_clean) <= t0 + k * period <= np.max(time_clean)]
for tt in transit_times:
    ax1.axvspan(tt - duration/2, tt + duration/2, color='#FEF08A', alpha=0.5, zorder=0)

ax1.set_title('(a) Chuỗi thời gian đường cong ánh sáng liên tục 27 ngày (TESS Sector 1 — TIC 25155310 / WASP-126 b)', 
              fontsize=11.5, fontweight='bold', pad=12, color='#0F172A', loc='left')
ax1.set_xlabel('Thời gian quan sát nhật tâm BTJD (ngày)', fontsize=10.5, fontweight='bold', color='#1E293B')
ax1.set_ylabel('Thông lượng chuẩn hóa', fontsize=10.5, fontweight='bold', color='#1E293B')
ax1.set_xlim(1324.5, 1354.0)
ax1.set_ylim(-0.022, 0.008)
ax1.grid(True, linestyle='--', alpha=0.45, color='#CBD5E1')
ax1.legend(loc='upper right', framealpha=0.95, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=9.0)

# Chú thích Panel 1 ở vùng thoáng
ax1.annotate('Vết sụt sáng lặp lại tuần hoàn\n(Chu kỳ P ≈ 3.29 ngày, độ sâu ~1.5%)', 
             xy=(transit_times[2], -0.015), xytext=(transit_times[2] - 3.2, -0.0205),
             arrowprops=dict(facecolor='#15803D', edgecolor='#15803D', arrowstyle='->', lw=1.2),
             fontsize=8.5, color='#166534', fontweight='bold')

# ==================== PANEL 2: PHASE-FOLDED LIGHT CURVE ====================
# Điểm đo riêng lẻ đã gấp pha
ax2.plot(phase, flux_clean, '.', color='#93C5FD', markersize=2.0, alpha=0.35, rasterized=True,
         label='Các điểm đo riêng lẻ sau khi gấp pha (Individual data points)')

# Điểm trung bình nhóm (Binned Points)
valid_bins = np.isfinite(binned_flux)
ax2.plot(bin_centers[valid_bins], binned_flux[valid_bins], 'o', color='#1E3A8A', markersize=4.2, zorder=4,
         label='Điểm trung vị gom nhóm (Binned median profile, 150 bins)')

# Đường nối các điểm binned thể hiện đáy chữ U mượt mà
ax2.plot(bin_centers[valid_bins], binned_flux[valid_bins], '-', color='#DC2626', linewidth=1.8, zorder=3, alpha=0.85,
         label='Đường cong hình thái quá cảnh (Transit Dip Profile)')

ax2.axhline(0.0, color='#64748B', linestyle='--', linewidth=1.0)
ax2.axvline(0.0, color='#94A3B8', linestyle=':', linewidth=1.0)

ax2.set_title('(b) Đường cong ánh sáng sau khi gấp pha chu kỳ (Phase-Folded Light Curve, P = 3.2888 ngày)', 
              fontsize=11.5, fontweight='bold', pad=12, color='#0F172A', loc='left')
ax2.set_xlabel('Thời gian tương đối tính từ tâm quá cảnh (ngày)', fontsize=10.5, fontweight='bold', color='#1E293B')
ax2.set_ylabel('Thông lượng chuẩn hóa', fontsize=10.5, fontweight='bold', color='#1E293B')
ax2.set_xlim(-0.8, 0.8)
ax2.set_ylim(-0.020, 0.008)
ax2.grid(True, linestyle='--', alpha=0.45, color='#CBD5E1')
ax2.legend(loc='upper right', framealpha=0.95, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=9.0)

# Chú thích Panel 2 ở vùng thoáng
ax2.annotate('Hình thái vết lõm đáy phẳng chữ U (U-shaped dip)\n(Minh chứng kinh điển của ngoại hành tinh quá cảnh)', 
             xy=(0.0, -0.015), xytext=(0.12, -0.0185),
             arrowprops=dict(facecolor='#DC2626', edgecolor='#DC2626', arrowstyle='->', lw=1.2),
             fontsize=8.5, color='#991B1B', fontweight='bold')

ax2.annotate('Thời lượng quá cảnh ~3.7 giờ\n(Transit Duration ≈ 0.155 ngày)', 
             xy=(-0.077, -0.008), xytext=(-0.65, -0.012),
             arrowprops=dict(facecolor='#1E293B', edgecolor='#1E293B', arrowstyle='->', lw=1.0),
             fontsize=8.5, color='#1E293B', fontweight='semibold')

import os
plt.tight_layout()

out1 = os.path.join(os.path.dirname(__file__), 'fig5_phase_folding.png')
fig.savefig(out1, dpi=300, bbox_inches='tight', facecolor='#FFFFFF')
print(f"Successfully generated Figure 5: {out1}")

