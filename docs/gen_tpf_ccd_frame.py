import numpy as np
import matplotlib.pyplot as plt
from astropy.io import fits

# Đọc tệp TPF FITS thực tế
tpf_path = '/home/phucle/.cache/lightkurve/mastDownload/TESS/tess2018206045859-s0001-0000000025155310-0120-s/tess2018206045859-s0001-0000000025155310-0120-s_tp.fits'

with fits.open(tpf_path) as hdul:
    flux_3d = hdul[1].data['FLUX'] # (20076, 11, 11)
    time = hdul[1].data['TIME']

# Lấy 1 khung hình chụp thực tế tại thời điểm t0 (Cadence thứ 100)
single_frame = flux_3d[100]

# Vẽ ảnh PNG chụp trực tiếp từ cảm biến CCD của TESS
fig, ax = plt.subplots(figsize=(7, 7), dpi=300)
fig.patch.set_facecolor('#0F172A') # Nền tối phong cách thiên văn
ax.set_facecolor('#0F172A')

# Hiển thị ma trận 11x11 pixel theo tông màu vũ trụ thực tế
im = ax.imshow(single_frame, origin='lower', cmap='magma', interpolation='nearest')

# Lưới pixel
ax.set_xticks(np.arange(-0.5, 11, 1), minor=True)
ax.set_yticks(np.arange(-0.5, 11, 1), minor=True)
ax.grid(which='minor', color='#94A3B8', linestyle=':', linewidth=0.8, alpha=0.5)

ax.set_xticks(np.arange(0, 11, 2))
ax.set_yticks(np.arange(0, 11, 2))
ax.tick_params(colors='#F8FAFC', labelsize=10)

ax.set_title(f'Ảnh chụp CCD thực tế từ TESS (TIC 25155310)\nKhung hình ma trận {single_frame.shape[0]}x{single_frame.shape[1]} Pixel tại ngày {time[100]:.2f} BTJD', 
             fontsize=11.5, fontweight='bold', color='#F8FAFC', pad=12)
ax.set_xlabel('Tọa độ cột cảm biến (CCD Column Pixel)', fontsize=10, fontweight='bold', color='#F8FAFC')
ax.set_ylabel('Tọa độ hàng cảm biến (CCD Row Pixel)', fontsize=10, fontweight='bold', color='#F8FAFC')

cbar = plt.colorbar(im, ax=ax, fraction=0.046, pad=0.04)
cbar.set_label('Số đếm Photon / giây ($e^-/\\text{s}$)', color='#F8FAFC', fontsize=9.5, fontweight='bold')
cbar.ax.yaxis.set_tick_params(color='#F8FAFC')
plt.setp(plt.getp(cbar.ax.axes, 'yticklabels'), color='#F8FAFC')

import os
plt.tight_layout()
out_png = os.path.join(os.path.dirname(__file__), 'fig_tpf_ccd_frame.png')
fig.savefig(out_png, dpi=300, facecolor=fig.get_facecolor(), bbox_inches='tight')
print("Rendered raw TPF frame to:", out_png)

