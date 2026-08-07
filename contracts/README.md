# Contracts

This directory defines shared data contracts and event schemas for the AURORA platform.

## Structure

* `events/`: Event schemas (e.g. `bronze-object-ready.schema.json`, `preprocess-completed.schema.json`, `model-promoted.schema.json`)
* `data/`: Data schemas (e.g. `silver-lightcurve.schema.json`, `gold-features.schema.json`, `prediction.schema.json`)

## Rules

1. Contracts are shared specifications only (JSON Schemas, Proto, etc.).
2. No shared business-logic code or application libraries live here.
3. Each service implements language-native representations derived from these contracts.
