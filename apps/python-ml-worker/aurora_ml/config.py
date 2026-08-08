import os


class Config:
    def __init__(self):
        self.env = self._require_env("AURORA_ENV")
        self.log_level = self._require_env("AURORA_LOG_LEVEL")
        self.minio_endpoint = self._require_env("MINIO_ENDPOINT")
        self.minio_bucket = self._require_env("MINIO_BUCKET")
        self.nats_url = self._require_env("NATS_URL")

        self.device = self._require_env("AURORA_ML_DEVICE").lower()
        if self.device != "cuda":
            raise ValueError(
                f"Invalid AURORA_ML_DEVICE: '{self.device}'. GPU-only training requires 'cuda'"
            )

        try:
            self.batch_size = int(self._require_env("AURORA_ML_BATCH_SIZE"))
            if self.batch_size < 1:
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_ML_BATCH_SIZE must be a positive integer.")

        try:
            self.max_vram_mb = int(self._require_env("AURORA_ML_MAX_VRAM_MB"))
            if self.max_vram_mb < 0:
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_ML_MAX_VRAM_MB must be a non-negative integer.")

        # Stage 5 LC Feature Extraction Configuration
        self.lc_feature_version = os.getenv("AURORA_LC_FEATURE_VERSION", "lc-features-v1")
        self.bls_min_period_days = float(os.getenv("AURORA_LC_BLS_MIN_PERIOD_DAYS", "0.5"))
        self.bls_max_period_days = float(os.getenv("AURORA_LC_BLS_MAX_PERIOD_DAYS", "20.0"))
        self.bls_min_points = int(os.getenv("AURORA_LC_MIN_POINTS", "100"))

        if self.bls_min_period_days <= 0:
            raise ValueError("AURORA_LC_BLS_MIN_PERIOD_DAYS must be > 0")
        if self.bls_max_period_days <= self.bls_min_period_days:
            raise ValueError("AURORA_LC_BLS_MAX_PERIOD_DAYS must be > AURORA_LC_BLS_MIN_PERIOD_DAYS")
        if self.bls_min_points < 1:
            raise ValueError("AURORA_LC_MIN_POINTS must be >= 1")

        # Stage 5 TPF & FFI Evidence Feature Extraction Configuration
        self.tpf_feature_version = os.getenv("AURORA_TPF_FEATURE_VERSION", "tpf-vetting-v1")
        self.tpf_transit_window_factor = float(os.getenv("AURORA_TPF_TRANSIT_WINDOW_FACTOR", "1.0"))
        self.tpf_out_guard_factor = float(os.getenv("AURORA_TPF_OUT_GUARD_FACTOR", "2.0"))
        self.tpf_min_in_transit_cadences = int(os.getenv("AURORA_TPF_MIN_IN_TRANSIT_CADENCES", "3"))
        self.tpf_min_out_transit_cadences = int(os.getenv("AURORA_TPF_MIN_OUT_TRANSIT_CADENCES", "20"))
        self.ffi_feature_version = os.getenv("AURORA_FFI_FEATURE_VERSION", "ffi-evidence-v1")

        if self.tpf_transit_window_factor <= 0:
            raise ValueError("AURORA_TPF_TRANSIT_WINDOW_FACTOR must be > 0")
        if self.tpf_out_guard_factor < self.tpf_transit_window_factor:
            raise ValueError("AURORA_TPF_OUT_GUARD_FACTOR must be >= AURORA_TPF_TRANSIT_WINDOW_FACTOR")
        if self.tpf_min_in_transit_cadences < 1:
            raise ValueError("AURORA_TPF_MIN_IN_TRANSIT_CADENCES must be >= 1")
        if self.tpf_min_out_transit_cadences < 1:
            raise ValueError("AURORA_TPF_MIN_OUT_TRANSIT_CADENCES must be >= 1")

        # Stage 5 Catalog & Label Versioning Configuration
        self.toi_period_rel_tolerance = float(os.getenv("AURORA_TOI_PERIOD_REL_TOLERANCE", "0.05"))
        self.label_policy_version = os.getenv("AURORA_LABEL_POLICY_VERSION", "candidate-label-policy-v1")
        self.toi_match_version = os.getenv("AURORA_TOI_MATCH_VERSION", "toi-match-v1")
        self.tic_source = os.getenv("AURORA_TIC_SOURCE", "local")
        self.toi_source = os.getenv("AURORA_TOI_SOURCE", "local")
        self.tce_source = os.getenv("AURORA_TCE_SOURCE", "local")

        if self.toi_period_rel_tolerance <= 0:
            raise ValueError("AURORA_TOI_PERIOD_REL_TOLERANCE must be > 0")

        # Stage 5.6 ClickHouse Analytical Configuration
        self.clickhouse_host = os.getenv("AURORA_CLICKHOUSE_HOST", "clickhouse")
        self.clickhouse_port = int(os.getenv("AURORA_CLICKHOUSE_PORT", "8123"))
        self.clickhouse_user = os.getenv("AURORA_CLICKHOUSE_USER", "default")
        self.clickhouse_password = os.getenv("AURORA_CLICKHOUSE_PASSWORD", "")
        self.clickhouse_database = os.getenv("AURORA_CLICKHOUSE_DATABASE", "aurora")

    def _require_env(self, key: str) -> str:
        val = os.getenv(key)
        if not val:
            raise ValueError(f"Missing required environment variable '{key}'")
        return val

    def log_summary(self):
        print(
            f"[aurora-ml-worker] Config: env={self.env}, log_level={self.log_level}, device={self.device}, batch_size={self.batch_size}, vram={self.max_vram_mb}MB"
        )
