import os
import matplotlib.pyplot as plt
import matplotlib.patches as patches

# Modern scientific clean style
plt.rcParams['font.sans-serif'] = 'DejaVu Sans'
plt.rcParams['figure.facecolor'] = '#F8FAFC'

fig, ax = plt.subplots(figsize=(14, 8.5), dpi=300)
ax.set_facecolor('#F8FAFC')
ax.set_xlim(0, 100)
ax.set_ylim(0, 100)
ax.axis('off')

# Tiêu đề chính
ax.text(50, 96.5, 'Figure 1: AURORA Cosmic Data Platform — End-to-End System Architecture', 
        fontsize=14, fontweight='bold', color='#0F172A', ha='center', va='center')
ax.text(50, 93.8, 'Decoupled Medallion Lakehouse (Bronze -> Silver -> Gold) with Sub-Millisecond OLAP & Production ML Inference', 
        fontsize=9.5, color='#475569', ha='center', va='center')

def draw_box(x, y, w, h, title, subtitle, bg_color, border_color, items=None, badge=None):
    # Shadow
    rect_s = patches.FancyBboxPatch((x + 0.4, y - 0.4), w, h, boxstyle="round,pad=0.5,rounding_size=0.8",
                                   facecolor='#CBD5E1', edgecolor='none', alpha=0.4, zorder=2)
    ax.add_patch(rect_s)
    
    # Main Box
    rect = patches.FancyBboxPatch((x, y), w, h, boxstyle="round,pad=0.5,rounding_size=0.8",
                                  facecolor=bg_color, edgecolor=border_color, linewidth=1.5, zorder=3)
    ax.add_patch(rect)
    
    # Title
    ax.text(x + 1.2, y + h - 2.2, title, fontsize=9.5, fontweight='bold', color='#0F172A', zorder=4)
    if subtitle:
        ax.text(x + 1.2, y + h - 4.2, subtitle, fontsize=7.5, color='#64748B', zorder=4)
        
    # Badge
    if badge:
        bx = x + w - 1.2
        by = y + h - 2.2
        ax.text(bx, by, badge, fontsize=7.0, fontweight='bold', color=border_color, 
                ha='right', va='center', zorder=4,
                bbox=dict(boxstyle='round,pad=0.2', facecolor='#FFFFFF', edgecolor=border_color, lw=1.0))
        
    # Items
    if items:
        start_y = y + h - 6.5
        for i, it in enumerate(items):
            cur_y = start_y - (i * 2.8)
            ax.plot([x + 1.8], [cur_y + 0.3], marker='s', markersize=3.5, color=border_color, zorder=4)
            ax.text(x + 3.0, cur_y, it, fontsize=7.8, color='#1E293B', zorder=4)

def draw_arrow(x1, y1, x2, y2, label=None, color='#64748B'):
    ax.annotate('', xy=(x2, y2), xytext=(x1, y1),
                arrowprops=dict(arrowstyle="-|>", color=color, lw=1.6, mutation_scale=14), zorder=5)
    if label:
        mx, my = (x1 + x2) / 2, (y1 + y2) / 2 + 1.0
        ax.text(mx, my, label, fontsize=7.5, fontweight='bold', color=color, ha='center', va='bottom', zorder=6,
                bbox=dict(boxstyle='round,pad=0.15', facecolor='#FFFFFF', edgecolor=color, lw=0.6, alpha=0.9))

# 1. External Ingestion Source
draw_box(2, 54, 15, 34, "1. INGESTION", "NASA Space Missions", "#FFFFFF", "#3B82F6", [
    "NASA MAST Archive",
    "TESS Sector Light Curves",
    "Target Pixel Files (TPF)",
    "FITS Format (.fits)",
    "Streaming HTTP Ingest"
], "SOURCE")

# 2. Bronze Lakehouse
draw_box(21, 54, 17, 34, "2. BRONZE TIER", "MinIO Object Storage", "#EFF6FF", "#2563EB", [
    "MinIO S3 Bucket (bronze/)",
    "Raw Unmodified FITS",
    "Rolling Retention (~50 GiB)",
    "Event Eviction Policy",
    "Durable SHA-256 Digest"
], "RAW")

# 3. Rust Preprocessor & Silver
draw_box(42, 54, 17, 34, "3. SILVER TIER", "Rust High-Perf Engine", "#F0FDF4", "#16A34A", [
    "Rust Preprocessor (FITS)",
    "Quality Bitmask Filter",
    "PDCSAP & SAP Clean",
    "Outlier Median Clipping",
    "Parquet Serialization"
], "CLEANED")

# 4. Python Gold Builder & Feature Engine
draw_box(63, 54, 17, 34, "4. GOLD TIER", "Science Feature Eng.", "#FEFCE8", "#CA8A04", [
    "Box Least Squares (BLS)",
    "Transit Ephemeris (P, τ, δ)",
    "TPF Aperture Centroid",
    "Immutable Snapshots",
    "Manifest Verification"
], "ENRICHED")

# 5. Production Inference & ML Platform
draw_box(83, 54, 15, 34, "5. ML RUNTIME", "Stage 6-7 Inference", "#FAF5FF", "#9333EA", [
    "Rust ONNX Worker",
    "CUDA / CPU Execution",
    "Candidate Vetting (TCE)",
    "Spatial Autoencoders",
    "NATS Stream Dispatch"
], "INFERENCE")

# BOTTOM LAYER: Storage & Serving & Observatory Dashboard

# 6. ClickHouse OLAP
draw_box(21, 8, 25, 36, "6. ANALYTICS & STORAGE", "ClickHouse Columnar Database", "#FFFBEB", "#D97706", [
    "Real-time Telemetry & KPIs",
    "aurora.pipeline_runs_v1",
    "aurora.candidate_features_v1",
    "aurora.factory_tickets_v1",
    "aurora.lakehouse_objects",
    "Sub-millisecond Vector SQL"
], "OLAP")

# 7. Go Core API Service
draw_box(50, 8, 20, 36, "7. API GATEWAY", "Go Backend Engine (Port 8080)", "#F0FDFA", "#0D9488", [
    "High-Concurrency REST API",
    "Stateless Lakehouse Sync",
    "Server-Sent Events (SSE)",
    "Direct ClickHouse Connector",
    "Deterministic Ticket Orchestrator"
], "GO API")

# 8. Dashboard Presentation
draw_box(74, 8, 24, 36, "8. OBSERVATORY UI", "React / Vite (Port 8501)", "#F8FAFC", "#475569", [
    "Interactive Pipeline DAG (22 Hops)",
    "Lineage Explorer & Provenance",
    "Factory History & Tickets",
    "Photometry & Phase Visualizer",
    "Model Registry & Vetting"
], "DASHBOARD")

# Connections (Flow arrows)
draw_arrow(17, 71, 21, 71, "FITS Stream", "#2563EB")
draw_arrow(38, 71, 42, 71, "Raw Feed", "#16A34A")
draw_arrow(59, 71, 63, 71, "Parquet", "#CA8A04")
draw_arrow(80, 71, 83, 71, "Gold Snapshots", "#9333EA")

# Downward arrows to storage and serving
draw_arrow(50, 54, 33, 44, "Event Sync", "#D97706")
draw_arrow(71, 54, 38, 44, "Catalog Features", "#D97706")
draw_arrow(90, 54, 43, 44, "Predictions", "#D97706")

draw_arrow(46, 26, 50, 26, "Fast SQL Queries", "#0D9488")
draw_arrow(70, 26, 74, 26, "REST & SSE", "#475569")

# Architectural Boundary Box (Dashed outer)
arch_rect = patches.FancyBboxPatch((1, 4), 98, 88, boxstyle="round,pad=1.0,rounding_size=1.0",
                                  facecolor='none', edgecolor='#CBD5E1', linewidth=1.2, linestyle='--', zorder=1)
ax.add_patch(arch_rect)

plt.tight_layout()
out_fig1 = os.path.join(os.path.dirname(__file__), 'fig1_system_architecture.png')
fig.savefig(out_fig1, dpi=300, bbox_inches='tight', facecolor='#F8FAFC')
print(f"Successfully generated Figure 1: {out_fig1}")
