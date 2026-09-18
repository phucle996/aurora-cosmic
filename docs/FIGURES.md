# Scientific Figures & Architectural Visualizations

This document catalogues the official publication-grade figures for the **AURORA Cosmic Data Platform**, detailing their scientific methodology, equations, and reproducible generation scripts.

---

## Portfolio Summary

| Figure | Identifier | Scientific / Architectural Domain | Generator Script | Primary Data Source |
|---|---|---|---|---|
| **Fig 1** | `fig1_system_architecture.png` | End-to-End Medallion Lakehouse Architecture | `gen_fig1_architecture.py` | System Architecture Spec |
| **Fig 2** | `fig2_preprocessing_lightcurve.png` | Signal Preprocessing & Detrending (Bronze $\to$ Silver) | `gen_fig2_preprocessing.py` | NASA TESS (TIC 25155310 / WASP-126 b) |
| **Fig 3** | `fig3_bls_periodogram.png` | Box Least Squares (BLS) Ephemeris Search (Gold) | `gen_fig3_bls_periodogram.py` | Cleaned PDCSAP Flux |
| **Fig 4** | `fig4_flux_distribution.png` | Statistical Flux Distribution & Outlier Detection | `gen_fig4_flux_distribution.py` | Cleaned PDCSAP Flux |
| **Fig 5** | `fig5_phase_folding.png` | Phase-Folded Planetary Transit Model | `gen_fig5_phase_folding.py` | Binned Phase $\phi \in [-0.5, 0.5]$ |
| **Fig 6** | `fig6_tpf_heatmap.png` | 2D CCD Sensor Matrix & Aperture Mask (TPF) | `gen_fig6_tpf_heatmap.py` | TESS Target Pixel File (`_tp.fits`) |
| **Fig 7** | `fig7_difference_imaging.png` | Difference Imaging & Centroid Motion Vetting | `gen_fig7_difference_imaging.py` | In/Out-of-Transit Frames |
| **Fig 8** | `fig8_ml_model_evaluation.png` | Candidate Vetting (TCE) & Anomaly Evaluation | `gen_fig8_ml_evaluation.py` | Stage 6/7 Inference Benchmarks |

---

## Figure Details

### Figure 1: End-to-End System Architecture
- **Description**: Visualizes the decoupled 3-tier Medallion architecture (Bronze MinIO raw FITS $\to$ Silver Rust Preprocessor Parquet $\to$ Gold Python Feature Builder with BLS), connected with ClickHouse columnar OLAP, Rust ONNX inference worker, Go API gateway, and the React scientific dashboard.
- **Artifact**: `docs/fig1_system_architecture.png`
- **Reproduce**: `uv run --with numpy,matplotlib python docs/gen_fig1_architecture.py`

### Figure 2: Lightcurve Preprocessing & Instrumental Calibration
- **Description**: Demonstrates raw Simple Aperture Photometry (SAP) flux affected by spacecraft momentum dumps and thermal drift, calibrated to Pre-search Data Conditioning SAP (PDCSAP) flux with outlier rejection, revealing the periodic planetary transit dips of WASP-126 b ($\delta \approx 0.65\%$, $P \approx 3.2886$ d).
- **Artifact**: `docs/fig2_preprocessing_lightcurve.png`
- **Reproduce**: `uv run --with numpy,matplotlib,astropy python docs/gen_fig2_preprocessing.py`

### Figure 3: Box Least Squares (BLS) Periodogram & Ephemeris Discovery
- **Description**: Power spectrum computed across trial orbital periods $P \in [1.0, 10.0]$ days via Box Least Squares fitting. Identifies the distinct global maximum at $P_0 = 3.2886$ days ($S/N \approx 12.1\sigma$) with harmonic markers ($P_0/2 = 1.644$ d, $2P_0 = 6.577$ d), and a high-resolution zoom-in around the peak epoch.
- **Artifact**: `docs/fig3_bls_periodogram.png`
- **Reproduce**: `uv run --with numpy,matplotlib,astropy,scipy python docs/gen_fig3_bls_periodogram.py`

### Figure 4: Statistical Flux Distribution & Transit Outlier Modeling
- **Description**: Empirical probability density function (PDF) versus theoretical Gaussian fit for normalized stellar flux, isolating the non-Gaussian negative skewness tail caused by planetary transit attenuation.
- **Artifact**: `docs/fig4_flux_distribution.png`
- **Reproduce**: `uv run --with numpy,matplotlib,astropy,scipy python docs/gen_fig4_flux_distribution.py`

### Figure 5: Phase-Folded Planetary Transit Curve
- **Description**: Time-series folded modulo the discovered orbital period $P = 3.2888$ days:
  $$\phi(t) = \left(\frac{t - t_0}{P} \pmod 1\right) - 0.5$$
  Displays all observed transits superimposed with a binned running median, quantifying transit depth ($\sim 1.5\%$) and duration ($\sim 3.7$ hours).
- **Artifact**: `docs/fig5_phase_folding.png`
- **Reproduce**: `uv run --with numpy,matplotlib,astropy python docs/gen_fig5_phase_folding.py`

### Figure 6: Target Pixel File (TPF) CCD Sensor Matrix & Optimal Aperture Mask
- **Description**: 2D spatial photometry over an $11 \times 11$ CCD pixel grid. Displays raw photon counts ($e^-/\text{s}$), pixel background subtraction, and NASA SPOC pipeline photometric aperture mask.
- **Artifact**: `docs/fig6_tpf_heatmap.png`
- **Reproduce**: `uv run --with numpy,matplotlib,astropy python docs/gen_fig6_tpf_heatmap.py`

### Figure 7: In-Transit vs Out-of-Transit Difference Imaging & Centroid Motion Vetting
- **Description**: Critical astrophysical validation to rule out Background Eclipsing Binary (BEB) false positives. Compares out-of-transit flux $I_{\text{out}}$, in-transit flux $I_{\text{in}}$, and pixel difference $\Delta I = I_{\text{out}} - I_{\text{in}}$. Demonstrates measured photon deficit centroid offset $\Delta r \approx 0.108$ px ($2.26"$), well within the $3\sigma$ stellar target limit ($< 0.15$ px).
- **Artifact**: `docs/fig7_difference_imaging.png`
- **Reproduce**: `uv run --with numpy,matplotlib,astropy,scipy python docs/gen_fig7_difference_imaging.py`

### Figure 8: Machine Learning Candidate Vetting & Model Evaluation
- **Description**: Comprehensive evaluation of Stage 6/7 ML classification:
  - **Panel 8A**: ROC Curve ($\text{AUC} = 0.939$) for Threshold Candidate Event (TCE) classification.
  - **Panel 8B**: Precision-Recall Curve ($\text{PR-AUC} = 0.844$) under class-imbalanced conditions.
  - **Panel 8C**: Candidate Score Probability distribution $\sigma(\text{logit})$ exhibiting bimodal separation.
  - **Panel 8D**: Autoencoder reconstruction MSE distribution (log scale) isolating spacecraft jitter and instrumental defects.
- **Artifact**: `docs/fig8_ml_model_evaluation.png`
- **Reproduce**: `uv run --with numpy,matplotlib,scikit-learn python docs/gen_fig8_ml_evaluation.py`
