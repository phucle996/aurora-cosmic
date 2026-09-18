import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits
from matplotlib.patches import Rectangle

# Cấu hình phong cách đồ họa khoa học Light Mode
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#1E293B'
plt.rcParams['axes.linewidth'] = 1.0
plt.rcParams['figure.facecolor'] = '#FFFFFF'
plt.rcParams['axes.facecolor'] = '#FFFFFF'

# 1. Đọc tệp TPF thực tế của NASA TESS (_tp.fits)
tpf_path = '/home/phucle/.cache/lightkurve/mastDownload/TESS/tess2018206045859-s0001-0000000025155310-0120-s/tess2018206045859-s0001-0000000025155310-0120-s_tp.fits'

with fits.open(tpf_path) as hdul:
    table_data = hdul[1].data
    aperture_mask = hdul[2].data # Aperture bitmask
    time = np.array(table_data['TIME'], dtype=np.float64)
    flux_3d = np.array(table_data['FLUX'], dtype=np.float32) # (N, 11, 11)
    quality = np.array(table_data['QUALITY'], dtype=np.int32)

# Lọc các nhịp đo hợp lệ (QUALITY == 0 và thời gian hữu hạn)
valid_mask = np.isfinite(time) & (quality == 0)
time_clean = time[valid_mask]
flux_clean = flux_3d[valid_mask] # Shape: (valid_N, 11, 11)

# 2. Phân tách nhịp đo: In-transit vs Out-of-transit
# Tham số của WASP-126 b: P = 3.2888 ngày, t0 = 1327.352, duration = 0.155 ngày (~3.7 giờ)
period = 3.2888
t0 = 1327.352
duration = 0.155

phase = ((time_clean - t0 + 0.5 * period) % period) - 0.5 * period
in_transit_mask = np.abs(phase) < (0.45 * duration) # Trong thời gian sụt sáng
out_of_transit_mask = (np.abs(phase) > (0.8 * duration)) & (np.abs(phase) < (2.0 * duration)) # Ngay cạnh cửa sổ

# Tính ma trận ảnh trung bình (Average Pixel Frames)
img_out = np.nanmedian(flux_clean[out_of_transit_mask], axis=0) # Out-of-transit
img_in = np.nanmedian(flux_clean[in_transit_mask], axis=0)   # In-transit
diff_img = img_out - img_in # Bản đồ sai phân thiếu hụt thông lượng

# 3. Tính toán trọng tâm chùm sáng (Centroid) của Difference Image
# Centroid = sum(r * flux) / sum(flux)
positive_diff = np.maximum(diff_img, 0)
rows, cols = np.indices(diff_img.shape)
total_deficit = np.sum(positive_diff)
centroid_row = np.sum(rows * positive_diff) / total_deficit
centroid_col = np.sum(cols * positive_diff) / total_deficit

# Tâm quang học của sao mẹ (lấy từ Out-of-transit peak / centroid)
star_row = np.sum(rows * img_out) / np.sum(img_out)
star_col = np.sum(cols * img_out) / np.sum(img_out)
offset_pixels = np.sqrt((centroid_row - star_row)**2 + (centroid_col - star_col)**2)

# 4. Vẽ biểu đồ 3 Panel cạnh nhau
fig, (ax1, ax2, ax3) = plt.subplots(1, 3, figsize=(15.5, 5.5), dpi=300)

# Định vị thang màu chung cho Khung 1 và Khung 2
vmin_flux = np.nanpercentile(img_out, 5)
vmax_flux = np.nanpercentile(img_out, 99.5)

# ----------------- KHUNG 1: OUT-OF-TRANSIT -----------------
im1 = ax1.imshow(img_out, origin='lower', cmap='YlGnBu', vmin=vmin_flux, vmax=vmax_flux)
ax1.plot(star_col, star_row, '+', color='#DC2626', markersize=14, markeredgewidth=2.2, label='Tâm sao mẹ (Host Star)')
ax1.set_title('(a) Cường độ sáng lúc bình thường\n(Out-of-Transit Average)', fontsize=11.5, fontweight='bold', pad=10, color='#0F172A')
ax1.set_xlabel('Chỉ số cột Pixel (Column Index)', fontsize=10, fontweight='bold', color='#1E293B')
ax1.set_ylabel('Chỉ số hàng Pixel (Row Index)', fontsize=10, fontweight='bold', color='#1E293B')
ax1.legend(loc='upper right', framealpha=0.9, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=8.5)
cbar1 = plt.colorbar(im1, ax=ax1, fraction=0.046, pad=0.04)
cbar1.set_label('Thông lượng ($e^-/\\text{s}$)', fontsize=9, fontweight='semibold')

# ----------------- KHUNG 2: IN-TRANSIT -----------------
im2 = ax2.imshow(img_in, origin='lower', cmap='YlGnBu', vmin=vmin_flux, vmax=vmax_flux)
ax2.plot(star_col, star_row, '+', color='#DC2626', markersize=14, markeredgewidth=2.2, label='Tâm sao mẹ (Host Star)')
ax2.set_title('(b) Cường độ sáng lúc quá cảnh\n(In-Transit Average)', fontsize=11.5, fontweight='bold', pad=10, color='#0F172A')
ax2.set_xlabel('Chỉ số cột Pixel (Column Index)', fontsize=10, fontweight='bold', color='#1E293B')
ax2.set_ylabel('Chỉ số hàng Pixel (Row Index)', fontsize=10, fontweight='bold', color='#1E293B')
ax2.legend(loc='upper right', framealpha=0.9, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=8.5)
cbar2 = plt.colorbar(im2, ax=ax2, fraction=0.046, pad=0.04)
cbar2.set_label('Thông lượng ($e^-/\\text{s}$)', fontsize=9, fontweight='semibold')

# ----------------- KHUNG 3: DIFFERENCE IMAGE -----------------
im3 = ax3.imshow(diff_img, origin='lower', cmap='Reds', vmin=0, vmax=np.nanpercentile(diff_img, 99.5))
ax3.plot(star_col, star_row, '+', color='#1E3A8A', markersize=14, markeredgewidth=2.2, label='Tâm sao mẹ')
ax3.plot(centroid_col, centroid_row, 'x', color='#DC2626', markersize=12, markeredgewidth=2.2, 
         label=f'Tâm sụt sáng (Lệch: {offset_pixels:.2f} px)')

ax3.set_title('(c) Bản đồ chênh lệch thông lượng\n(Difference Image: $\\Delta\\text{Flux} = \\text{Out} - \\text{In}$)', 
              fontsize=11.5, fontweight='bold', pad=10, color='#0F172A')
ax3.set_xlabel('Chỉ số cột Pixel (Column Index)', fontsize=10, fontweight='bold', color='#1E293B')
ax3.set_ylabel('Chỉ số hàng Pixel (Row Index)', fontsize=10, fontweight='bold', color='#1E293B')
ax3.legend(loc='upper right', framealpha=0.9, facecolor='#FFFFFF', edgecolor='#CBD5E1', fontsize=8.5)
cbar3 = plt.colorbar(im3, ax=ax3, fraction=0.046, pad=0.04)
cbar3.set_label('Chênh lệch ($e^-/\\text{s}$)', fontsize=9, fontweight='semibold')

# Viền các ô pixel trên tất cả các subplot
for ax in (ax1, ax2, ax3):
    ax.set_xticks(np.arange(0, 11, 2))
    ax.set_yticks(np.arange(0, 11, 2))
    ax.grid(True, color='#E2E8F0', linestyle='-', linewidth=0.5, alpha=0.6)

import os
plt.tight_layout()

out1 = os.path.join(os.path.dirname(__file__), 'fig6_tpf_heatmap.png')
fig.savefig(out1, dpi=300, bbox_inches='tight', facecolor='#FFFFFF')
print(f"Successfully generated Figure 6: {out1}")

