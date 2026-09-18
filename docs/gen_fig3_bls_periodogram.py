import os
import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits
from astropy.timeseries import BoxLeastSquares

# Cấu hình phong cách đồ họa khoa học Light Mode
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#1E293B'
plt.rcParams['axes.linewidth'] = 1.0
plt.rcParams['figure.facecolor'] = '#FFFFFF'
plt.rcParams['axes.facecolor'] = '#FFFFFF'

# 1. Đọc dữ liệu FITS thực tế của NASA TESS (WASP-126 b / TIC 25155310)
fits_path = '/home/phucle/.cache/lightkurve/mastDownload/TESS/tess2018206045859-s0001-0000000025155310-0120-s/tess2018206045859-s0001-0000000025155310-0120-s_lc.fits'

with fits.open(fits_path) as hdul:
    data = hdul[1].data
    raw_time = np.array(data['TIME'], dtype=np.float64)
    raw_pdcsap = np.array(data['PDCSAP_FLUX'], dtype=np.float64)
    raw_qual = np.array(data['QUALITY'], dtype=np.int32)

# Lọc các điểm đo hợp lệ tầng Silver
mask = np.isfinite(raw_time) & np.isfinite(raw_pdcsap) & (raw_qual == 0)
time = raw_time[mask]
flux = raw_pdcsap[mask]
norm_flux = flux / np.nanmedian(flux)

# 2. Khởi tạo và chạy thuật toán Box Least Squares (BLS)
model = BoxLeastSquares(time, norm_flux)
# Quét chu kỳ từ 1.0 đến 10.0 ngày
durations = np.linspace(0.08, 0.22, 15) # Thời lượng quá cảnh dự kiến (~2-5 giờ)
periodogram = model.autopower(durations, minimum_period=1.0, maximum_period=10.0, frequency_factor=6.0)

# Tìm chu kỳ có công suất lớn nhất
best_idx = np.argmax(periodogram.power)
best_period = periodogram.period[best_idx]
max_power = periodogram.power[best_idx]
transit_time = periodogram.transit_time[best_idx]
duration = periodogram.duration[best_idx]
depth = periodogram.depth[best_idx]

# Tính Signal-to-Noise Ratio (SNR) xấp xỉ
mean_power = np.mean(periodogram.power)
std_power = np.std(periodogram.power)
snr = (max_power - mean_power) / std_power

# 3. Vẽ đồ thị khoa học 2 tầng (Toàn cảnh + Cận cảnh Đỉnh chu kỳ)
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(11, 7.5), dpi=300, gridspec_kw={'height_ratios': [1.8, 1.0]})

# TẦNG 1: Phổ chu kỳ toàn dải (1 - 10 ngày)
ax1.plot(periodogram.period, periodogram.power, color='#0284C7', lw=0.9, alpha=0.9, label='BLS Transit Power Spectrum')

# Đánh dấu đỉnh chính
ax1.axvline(best_period, color='#DC2626', linestyle='--', lw=1.3, alpha=0.85, label=f'Peak Period $P_0 = {best_period:.4f}$ d')

# Đánh dấu các hài bậc chu kỳ (Harmonics)
half_p = best_period / 2.0
double_p = best_period * 2.0
ax1.axvline(half_p, color='#EAB308', linestyle=':', lw=1.2, alpha=0.8, label=f'Harmonic $P_0/2 = {half_p:.3f}$ d')
if double_p <= 10.0:
    ax1.axvline(double_p, color='#CA8A04', linestyle=':', lw=1.2, alpha=0.8, label=f'Harmonic $2P_0 = {double_p:.3f}$ d')

ax1.set_title(f'Figure 3A: Box Least Squares (BLS) Periodogram for TIC 25155310 (WASP-126 b)\nDetection of Planetary Transit Period Across Search Grid [1.0 – 10.0 Days]', 
              fontsize=11.5, fontweight='bold', color='#0F172A', pad=12)
ax1.set_xlabel('Trial Orbital Period $P$ (Days)', fontsize=9.5, fontweight='bold', color='#1E293B')
ax1.set_ylabel('BLS Power Spectrum', fontsize=9.5, fontweight='bold', color='#1E293B')
ax1.set_xlim(1.0, 10.0)
ax1.set_ylim(0, max_power * 1.15)
ax1.grid(True, color='#E2E8F0', linestyle='--', linewidth=0.6, alpha=0.7)
ax1.legend(loc='upper right', framealpha=0.95, edgecolor='#CBD5E1', fontsize=8.5)

# Chú thích chi tiết tại đỉnh
ax1.annotate(f'Planetary Transit Peak: $P_0 = {best_period:.4f}$ Days\n'
             f'Transit Depth $\\delta \\approx {depth*100:.2f}\\%$\n'
             f'Duration $\\tau \\approx {duration*24:.2f}$ hours\n'
             f'Detection Significance: $S/N \\approx {snr:.1f}\\sigma$',
             xy=(best_period, max_power), xytext=(best_period + 0.65, max_power * 0.78),
             arrowprops=dict(facecolor='#DC2626', edgecolor='#DC2626', arrowstyle='->', lw=1.3),
             fontsize=9.0, color='#991B1B', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.4', facecolor='#FEF2F2', edgecolor='#FECACA', alpha=0.95))

# TẦNG 2: Cận cảnh đỉnh chu kỳ (Zoom-in Region quanh 3.286 ngày)
zoom_mask = (periodogram.period >= best_period - 0.15) & (periodogram.period <= best_period + 0.15)
ax2.plot(periodogram.period[zoom_mask], periodogram.power[zoom_mask], color='#0369A1', lw=1.6)
ax2.axvline(best_period, color='#DC2626', linestyle='--', lw=1.2)
ax2.scatter([best_period], [max_power], color='#DC2626', s=45, zorder=5)

ax2.set_title(f'Figure 3B: High-Resolution Zoom-in Peak Epoch ($P_0 = {best_period:.4f}$ Days)', 
              fontsize=10.0, fontweight='bold', color='#0F172A', pad=8)
ax2.set_xlabel('Trial Period (Days)', fontsize=9.0, fontweight='bold', color='#1E293B')
ax2.set_ylabel('BLS Power', fontsize=9.0, fontweight='bold', color='#1E293B')
ax2.grid(True, color='#E2E8F0', linestyle='--', linewidth=0.6, alpha=0.7)
ax2.set_xlim(best_period - 0.12, best_period + 0.12)

import os
plt.tight_layout()
out_file = os.path.join(os.path.dirname(__file__), 'fig3_bls_periodogram.png')
fig.savefig(out_file, dpi=300, bbox_inches='tight', facecolor='#FFFFFF')
print(f"Successfully generated Figure 3: {out_file}")
