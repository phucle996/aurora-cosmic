import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits
from scipy.stats import gaussian_kde

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

# Lọc sạch theo pipeline Silver: QUALITY == 0 và loại bỏ NaN
mask = np.isfinite(raw_time) & np.isfinite(raw_pdcsap) & (raw_qual == 0)
clean_pdcsap = raw_pdcsap[mask]

# Chuẩn hóa trung vị
med_val = np.nanmedian(clean_pdcsap)
norm_flux = (clean_pdcsap / med_val) - 1.0

# Lọc bỏ ngoại lai dương cực đoan do tia vũ trụ (>5 sigma), giữ trọn vẹn dải sụt sáng quá cảnh
mad = np.median(np.abs(norm_flux - np.median(norm_flux)))
robust_sigma = 1.4826 * mad
final_flux = norm_flux[(norm_flux < 5.0 * robust_sigma) & (norm_flux > -0.022)]

# 2. Tạo bố cục: 2 Subplots cạnh nhau (Trái: Histogram + KDE, Phải: Boxplot)
fig, (ax1, ax2) = plt.subplots(1, 2, figsize=(13.5, 6.2), gridspec_kw={'width_ratios': [2.2, 1.0]}, dpi=300)

# ==================== PANEL 1: HISTOGRAM & KDE ====================
# Tính toán histogram
counts, bins, patches = ax1.hist(final_flux, bins=80, density=True, 
                                 color='#93C5FD', edgecolor='#3B82F6', linewidth=0.6, alpha=0.6, 
                                 label='Phân bố tần suất quan sát (Histogram, 80 bins)')

# Tính toán đường cong mật độ KDE
kde = gaussian_kde(final_flux)
x_kde = np.linspace(np.min(final_flux), np.max(final_flux), 500)
y_kde = kde(x_kde)
ax1.plot(x_kde, y_kde, color='#1D4ED8', linewidth=2.2, label='Đường cong mật độ xác suất (KDE Estimate)')

# Đường trung vị và Gaussian lý thuyết
ax1.axvline(0.0, color='#DC2626', linestyle='--', linewidth=1.2, label='Đường trung vị chuẩn hóa (Median = 0.0)')

ax1.set_title('(a) Phân phối mật độ thông lượng ánh sáng chuẩn hóa (Histogram & KDE)', 
              fontsize=11.5, fontweight='bold', pad=12, color='#0F172A', loc='left')
ax1.set_xlabel('Thông lượng ánh sáng chuẩn hóa (Normalized Relative Flux)', fontsize=10.5, fontweight='bold', color='#1E293B')
ax1.set_ylabel('Mật độ xác suất (Density)', fontsize=10.5, fontweight='bold', color='#1E293B')
ax1.set_xlim(-0.020, 0.008)
ax1.grid(True, linestyle='--', alpha=0.45, color='#CBD5E1')
ax1.legend(loc='upper left', framealpha=0.95, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=9.0)

# Chú thích thanh mảnh ở vùng thoáng (phía trên, không che đỉnh histogram)
ax1.annotate('Đỉnh phân bố tập trung dày đặc quanh mốc 0.0\n(Độ nhọn cao Kurtosis > 0 biểu thị sao ổn định)', 
             xy=(0.0, np.max(y_kde)), xytext=(0.0015, np.max(y_kde) * 0.85),
             arrowprops=dict(facecolor='#1E293B', edgecolor='#1E293B', arrowstyle='->', lw=1.0),
             fontsize=8.5, color='#0F172A', fontweight='semibold')

ax1.annotate('Đuôi phân bố lệch âm kéo dài (Negative Skewness)\n(Tín hiệu sụt giảm thông lượng khi hành tinh quá cảnh)', 
             xy=(-0.014, 15), xytext=(-0.019, 120),
             arrowprops=dict(facecolor='#2563EB', edgecolor='#2563EB', arrowstyle='->', lw=1.2),
             fontsize=8.5, color='#1E40AF', fontweight='bold')

# ==================== PANEL 2: BOXPLOT ====================
flierprops = dict(marker='o', markersize=2.2, markerfacecolor='#DC2626', markeredgecolor='none', alpha=0.5)
boxprops = dict(facecolor='#DBEAFE', edgecolor='#1D4ED8', linewidth=1.2)
medianprops = dict(color='#DC2626', linewidth=1.8)
whiskerprops = dict(color='#1E293B', linewidth=1.1)
capprops = dict(color='#1E293B', linewidth=1.1)

bp = ax2.boxplot(final_flux, vert=True, patch_artist=True, widths=0.45,
                 boxprops=boxprops, medianprops=medianprops, 
                 whiskerprops=whiskerprops, capprops=capprops, flierprops=flierprops)

ax2.set_title('(b) Biểu đồ hộp (Boxplot)', fontsize=11.5, fontweight='bold', pad=12, color='#0F172A')
ax2.set_ylabel('Thông lượng ánh sáng chuẩn hóa', fontsize=10.5, fontweight='bold', color='#1E293B')
ax2.set_ylim(-0.020, 0.008)
ax2.set_xticklabels(['TIC 25155310'], fontsize=10.0, fontweight='semibold')
ax2.grid(True, linestyle='--', alpha=0.45, color='#CBD5E1')

# Chú thích Boxplot ở vùng thoáng bên phải
ax2.annotate('Hộp IQR rất hẹp quanh mốc 0.0\n(Độ biến thiên nền nhỏ)', 
             xy=(1.23, 0.0), xytext=(1.35, 0.003),
             arrowprops=dict(facecolor='#1E293B', edgecolor='#1E293B', arrowstyle='->', lw=1.0),
             fontsize=8.0, color='#1E293B', fontweight='semibold')

ax2.annotate('Các điểm dị thường âm (In-transit outliers)\nkéo dài đến -1.5% do ngoại hành tinh', 
             xy=(1.05, -0.014), xytext=(0.55, -0.018),
             arrowprops=dict(facecolor='#DC2626', edgecolor='#DC2626', arrowstyle='->', lw=1.1),
             fontsize=8.0, color='#991B1B', fontweight='bold')

import os
plt.tight_layout()

out1 = os.path.join(os.path.dirname(__file__), 'fig4_flux_distribution.png')
fig.savefig(out1, dpi=300, bbox_inches='tight', facecolor='#FFFFFF')
print(f"Successfully generated Figure 4: {out1}")

