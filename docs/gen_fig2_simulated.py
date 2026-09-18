import numpy as np
import matplotlib.pyplot as plt
import matplotlib.patches as mpatches

# Cấu hình font và style khoa học chuẩn Light Mode
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['axes.edgecolor'] = '#334155'
plt.rcParams['axes.linewidth'] = 1.0
plt.rcParams['figure.facecolor'] = '#FFFFFF'
plt.rcParams['axes.facecolor'] = '#FFFFFF'

# 1. Khởi tạo trục thời gian mô phỏng TESS Sector (27.4 ngày)
np.random.seed(42)
t_start = 1325.0
t_end = 1352.4
dt = 2.0 / (24.0 * 60.0)  # Cadence 2 phút
time = np.arange(t_start, t_end, dt)
n_points = len(time)

# Khoảng gián đoạn truyền tin giữa Sector (Downlink gap ~1.2 ngày quanh ngày 1338)
gap_mask = (time >= 1338.2) & (time <= 1339.4)
time = time[~gap_mask]
n_points = len(time)

# 2. Tạo tín hiệu quá cảnh hành tinh (Exoplanet Transit)
# Chu kỳ P = 3.52 ngày, thời điểm t0 = 1326.45, thời lượng duration = 0.14 ngày (3.3 giờ), độ sâu depth = 0.0075 (0.75%)
period = 3.52
t0 = 1326.45
duration = 0.14
depth = 0.0075

clean_flux = np.zeros(n_points)
phase = ((time - t0 + 0.5 * period) % period) - 0.5 * period
in_transit = np.abs(phase) < (0.5 * duration)

# Dạng đáy phẳng U-shaped dip
for i in range(n_points):
    if in_transit[i]:
        # Hàm hộp làm mịn bằng cosine
        norm_dist = np.abs(phase[i]) / (0.5 * duration)
        if norm_dist < 0.6:
            clean_flux[i] = -depth
        else:
            clean_flux[i] = -depth * 0.5 * (1.0 + np.cos(np.pi * (norm_dist - 0.6) / 0.4))

# Thêm nhiễu trắng ngẫu nhiên (Photon Gaussian noise ~ 450 ppm)
noise = np.random.normal(0, 0.00045, n_points)
silver_flux = clean_flux + noise

# 3. Tạo dữ liệu thô Bronze FITS (thêm xu hướng thiết bị, gai tia vũ trụ, lỗi chất lượng)
baseline_median = 49250.0  # e-/s
drift = 120.0 * np.sin(2 * np.pi * (time - t_start) / 40.0) - 80.0 * ((time - t_start) / 27.4)**2
raw_flux = (1.0 + silver_flux) * baseline_median + drift

# Thêm các gai nhọn tia vũ trụ (Cosmic Ray Spikes)
n_spikes = 35
spike_indices = np.random.choice(n_points, n_spikes, replace=False)
raw_flux[spike_indices] += np.random.uniform(1500.0, 4800.0, n_spikes)

# Thêm một số điểm lỗi cờ chất lượng (Momentum dump / Attitude jitter dips & jumps)
n_bad = 25
bad_indices = np.random.choice(n_points, n_bad, replace=False)
raw_flux[bad_indices] += np.random.uniform(-3500.0, -1200.0, n_bad)

# 4. Vẽ biểu đồ 2 panel
fig, (ax1, ax2) = plt.subplots(2, 1, figsize=(13, 7.5), sharex=True, dpi=300)

# PANEL 1: Raw Bronze Flux
ax1.plot(time, raw_flux, '.', color='#64748B', markersize=2.0, alpha=0.55, label='Thông lượng đo thô PDCSAP')
# Highlight các gai nhiễu
ax1.plot(time[spike_indices], raw_flux[spike_indices], '^', color='#DC2626', markersize=5.5, label='Nhiễu tia vũ trụ (Cosmic Ray Spikes)')
ax1.plot(time[bad_indices], raw_flux[bad_indices], 'v', color='#EA580C', markersize=5.5, label='Điểm lỗi cờ chất lượng (QUALITY != 0)')

ax1.set_title('(a) Dữ liệu thô tầng Bronze (Raw PDCSAP Flux trước tiền xử lý)', fontsize=12.5, fontweight='bold', pad=10, color='#0F172A')
ax1.set_ylabel('Thông lượng thô ($e^-/\\text{s}$)', fontsize=10.5, fontweight='semibold', color='#1E293B')
ax1.set_ylim(44000, 55500)
ax1.grid(True, linestyle='--', alpha=0.5, color='#CBD5E1')
ax1.legend(loc='upper right', framealpha=0.95, facecolor='#F8FAFC', edgecolor='#E2E8F0', fontsize=9.0)

# Chú thích panel 1
ax1.annotate('Gai nhọn tia vũ trụ\n(đột biến > 5σ)', 
             xy=(time[spike_indices[0]], raw_flux[spike_indices[0]]), 
             xytext=(time[spike_indices[0]] - 3.5, 53500),
             arrowprops=dict(facecolor='#DC2626', edgecolor='#DC2626', arrowstyle='->', lw=1.2),
             fontsize=8.5, color='#991B1B', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#FEF2F2', edgecolor='#FCA5A5', alpha=0.9))

ax1.annotate('Khoảng gián đoạn truyền tin\n(Downlink Data Gap ~1.2 ngày)', 
             xy=(1338.8, 49200), 
             xytext=(1333.5, 45200),
             arrowprops=dict(facecolor='#475569', edgecolor='#475569', arrowstyle='->', lw=1.2),
             fontsize=8.5, color='#334155', fontweight='semibold',
             bbox=dict(boxstyle='round,pad=0.3', facecolor='#F1F5F9', edgecolor='#CBD5E1', alpha=0.9))

# PANEL 2: Cleaned Silver Normalized Flux
ax2.plot(time, silver_flux, '.', color='#2563EB', markersize=2.2, alpha=0.65, label='Thông lượng sạch chuẩn hóa Silver')
ax2.axhline(0.0, color='#64748B', linestyle='--', linewidth=1.2, label='Đường nền chuẩn hóa (Baseline = 0.0)')

# Highlight các vết quá cảnh (Transit dips)
transit_times = [t0 + k * period for k in range(8) if t_start <= t0 + k * period <= t_end and not (1338.2 <= t0 + k * period <= 1339.4)]
for tt in transit_times:
    ax2.axvspan(tt - duration/2, tt + duration/2, color='#FEF08A', alpha=0.45)

ax2.set_title('(b) Dữ liệu chuẩn hóa tầng Silver (Cleaned Normalized Flux sau tiền xử lý)', fontsize=12.5, fontweight='bold', pad=10, color='#0F172A')
ax2.set_xlabel('Thời gian quan sát nhật tâm BTJD (ngày)', fontsize=10.5, fontweight='semibold', color='#1E293B')
ax2.set_ylabel('Thông lượng chuẩn hóa', fontsize=10.5, fontweight='semibold', color='#1E293B')
ax2.set_ylim(-0.012, 0.005)
ax2.grid(True, linestyle='--', alpha=0.5, color='#CBD5E1')
ax2.legend(loc='upper right', framealpha=0.95, facecolor='#F8FAFC', edgecolor='#E2E8F0', fontsize=9.0)

# Chú thích vết quá cảnh
target_transit = transit_times[2]
ax2.annotate('Vết sụt sáng quá cảnh định kỳ\n(Planetary Transit Dips: độ sâu ~0.75%, P ≈ 3.52 ngày)', 
             xy=(target_transit, -depth), 
             xytext=(target_transit + 1.2, -0.0105),
             arrowprops=dict(facecolor='#16A34A', edgecolor='#16A34A', arrowstyle='->', lw=1.3),
             fontsize=9.0, color='#14532D', fontweight='bold',
             bbox=dict(boxstyle='round,pad=0.4', facecolor='#F0FDF4', edgecolor='#86EFAC', alpha=0.95))

# Căn lề và xuất ảnh
plt.tight_layout()
import os
output_path1 = os.path.join(os.path.dirname(__file__), 'fig2_simulated_lightcurve.png')

fig.savefig(output_path1, dpi=300, bbox_inches='tight', facecolor='#FFFFFF')
print(f"Figure saved to: {output_path1}")

