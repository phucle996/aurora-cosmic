# Scientific Dashboard Service

`dashboard` is an interactive visualization application allowing astronomers to inspect target stars, plot light curves, examine TPF pixel heatmaps, review candidate scores, and analyze model evidence.

## Directory Structure

* `app.py` — Main UI entrypoint
* `api.py` — Client layer connecting to `go-api`
* `pages/overview.py` — Platform overview dashboard
* `pages/targets.py` — Star target catalog viewer
* `pages/lightcurves.py` — Time-series light curve visualizer
* `pages/candidates.py` — Exoplanet candidate ranking
* `pages/anomalies.py` — Anomaly detection inspector
* `pages/system.py` — Infrastructure & model health metrics
