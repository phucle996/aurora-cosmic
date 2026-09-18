import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits

# Cấu hình phong cách đồ họa khoa học Light Mode
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#1E293B'
plt.rcParams['axes.linewidth'] = 1.0
plt.rcParams['figure.facecolor'] = '#FFFFFF'
plt.rcParams['axes.facecolor'] = '#FFFFFF'

# 1. Đọc tệp FITS thực tế từ NASA MAST
fits_path = '/home/phucle/.cache/lightkurve/mastDownload/TESS/tess2018206045859-s0001-0000000025155310-0120-s/tess2018206045859-s0001-0000000025155310-0120-s_lc.fits'
with fits.open(fits_path) as hdul:
    data = hdul[1].data
    raw_time = np.array(data['TIME'], dtype=np.float64)
    raw_sap = np.array(data['SAP_FLUX'], dtype=np.float64)
    raw_pdcsap = np.array(data['PDCSAP_FLUX'], dtype=np.float64)
    raw_qual = np.array(data['QUALITY'], dtype=np.int32)

# 2. Xử lý tầng Bronze
# Các điểm đo thô có giá trị hợp lệ
valid_raw_mask = np.isfinite(raw_time) & np.isfinite(raw_sap)
bronze_time = raw_time[valid_raw_mask]
bronze_flux = raw_sap[valid_raw_mask]
bronze_qual = raw_qual[valid_raw_mask]

# Phân tách điểm đo đạt chuẩn vs điểm đo bị lỗi cờ chất lượng
good_raw_mask = (bronze_qual == 0)
bad_raw_mask = (bronze_qual != 0)

# 3. Tiền xử lý sang tầng Silver (chuẩn hóa trên PDCSAP)
# Lọc Strict Quality (QUALITY == 0) và loại bỏ NaN
silver_mask = np.isfinite(raw_time) & np.isfinite(raw_pdcsap) & (raw_qual == 0)
silver_time = raw_time[silver_mask]
silver_pdcsap = raw_pdcsap[silver_mask]

# Chuẩn hóa trung vị (Median-Normalization)
med_val = np.nanmedian(silver_pdcsap)
silver_norm_flux = (silver_pdcsap / med_val) - 1.0

# Lọc ngoại lai Sigma-clipping (5 sigma)
mad = np.median(np.abs(silver_norm_flux - np.median(silver_norm_flux)))
robust_sigma = 1.4826 * mad
# Chỉ lọc các điểm ngoại lai dương (tia vũ trụ) hoặc cực hạn ngoài dải quá cảnh
clip_mask = (silver_norm_flux < 5.0 * robust_sigma) & (silver_norm_flux > -0.025)
silver_time_final = silver_time[clip_mask]
silver_flux_final = silver_norm_flux[clip_mask]

# 4. Vẽ biểu đồ 2 Panel chuẩn đẹp, thoáng đãng
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(14, 8.2), sharex=True, dpi=300)

# ==================== PANEL 1: RAW BRONZE ====================
# Điểm đo bình thường
ax1.plot(bronze_time[good_raw_mask], bronze_flux[good_raw_mask], '.', 
         color='#475569', markersize=1.8, alpha=0.5, rasterized=True,
         label='Thông lượng đo thô ban đầu (SAP_FLUX, QUALITY == 0)')

# Điểm đo lỗi chất lượng (QUALITY != 0)
ax1.plot(bronze_time[bad_raw_mask], bronze_flux[bad_raw_mask], '.', 
         color='#DC2626', markersize=2.2, alpha=0.75, rasterized=True,
         label='Điểm đo lỗi thiết bị / nhiễu vệ tinh (QUALITY != 0, 1.798 điểm)')

ax1.set_title('(a) Dữ liệu thô thực tế tầng Bronze từ NASA TESS (TIC 25155310 — Sector 1, chưa qua tiền xử lý)', 
              fontsize=12, fontweight='bold', pad=12, color='#0F172A', loc='left')
ax1.set_ylabel('Thông lượng thô ($e^-/\\text{s}$)', fontsize=10.5, fontweight='bold', color='#1E293B')
ax1.set_ylim(6400, 9300)
ax1.grid(True, linestyle='--', alpha=0.45, color='#CBD5E1')

# Đưa Legend lên thanh tiêu đề trên cùng thoáng đãng, không che dữ liệu
ax1.legend(loc='upper right', framealpha=0.95, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=9.0)

# Chú thích thanh mảnh ở vùng thoáng (phía trên và dưới, không đè lên đường cong)
ax1.annotate('Hiện tượng trôi dạt đường nền do nhiệt độ cảm biến CCD lúc đầu Sector', 
             xy=(1327.5, 7800), xytext=(1326.0, 8900),
             arrowprops=dict(facecolor='#1E293B', edgecolor='#1E293B', arrowstyle='->', lw=1.0),
             fontsize=8.5, color='#1E293B', fontweight='semibold')

ax1.annotate('1.798 điểm đo bị cờ lỗi (QUALITY != 0) do biến cố rung quang học vệ tinh', 
             xy=(1347.0, 7150), xytext=(1339.5, 6650),
             arrowprops=dict(facecolor='#DC2626', edgecolor='#DC2626', arrowstyle='->', lw=1.0),
             fontsize=8.5, color='#B91C1C', fontweight='semibold')

# ==================== PANEL 2: CLEANED SILVER ====================
ax2.plot(silver_time_final, silver_flux_final, '.', 
         color='#2563EB', markersize=1.8, alpha=0.6, rasterized=True,
         label='Thông lượng sạch chuẩn hóa tầng Silver (Cleaned Normalized Flux)')

# Đường baseline 0.0
ax2.axhline(0.0, color='#64748B', linestyle='--', linewidth=1.2, label='Đường nền chuẩn hóa (Baseline = 0.0)')

# Tọa độ các vết sụt sáng quá cảnh thực tế của WASP-126 b (Chu kỳ P ≈ 3.288 ngày)
# Các thời điểm quá cảnh trong Sector 1: ~1327.35, 1330.64, 1333.93, 1337.22, 1340.51, 1343.80, 1347.08, 1350.37
transit_midpoints = [1327.35, 1330.64, 1333.93, 1337.22, 1340.51, 1343.80, 1347.08, 1350.37]
transit_dur = 0.16  # ~3.8 giờ

for t_mid in transit_midpoints:
    ax2.axvspan(t_mid - transit_dur/2, t_mid + transit_dur/2, color='#FEF08A', alpha=0.5, zorder=0)

ax2.set_title('(b) Dữ liệu sạch chuẩn hóa tầng Silver (Loại bỏ 100% lỗi cờ, chuẩn hóa trung vị quanh mức 0.0)', 
              fontsize=12, fontweight='bold', pad=12, color='#0F172A', loc='left')
ax2.set_xlabel('Thời gian quan sát chuẩn nhật tâm BTJD (ngày)', fontsize=10.5, fontweight='bold', color='#1E293B')
ax2.set_ylabel('Thông lượng chuẩn hóa', fontsize=10.5, fontweight='bold', color='#1E293B')
ax2.set_ylim(-0.022, 0.010)
ax2.grid(True, linestyle='--', alpha=0.45, color='#CBD5E1')

ax2.legend(loc='upper right', framealpha=0.95, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=9.0)

# Chú thích ở vùng trống phía dưới, mũi tên trỏ thanh mảnh lên vết lõm
ax2.annotate('Vết sụt sáng quá cảnh của hành tinh WASP-126 b (Chu kỳ P ≈ 3.29 ngày, độ sâu ~1.5%)', 
             xy=(1333.93, -0.015), xytext=(1331.0, -0.0205),
             arrowprops=dict(facecolor='#15803D', edgecolor='#15803D', arrowstyle='->', lw=1.2),
             fontsize=9.0, color='#166534', fontweight='bold')

import os
plt.tight_layout()

out1 = os.path.join(os.path.dirname(__file__), 'fig2_preprocessing_lightcurve.png')
fig.savefig(out1, dpi=300, bbox_inches='tight', facecolor='#FFFFFF')
print(f"Successfully generated Figure 2: {out1}")

