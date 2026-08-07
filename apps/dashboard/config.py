import os

class Config:
    def __init__(self):
        self.env = self._require_env("AURORA_ENV")
        self.log_level = self._require_env("AURORA_LOG_LEVEL")
        self.host = self._require_env("AURORA_DASHBOARD_HOST")
        self.api_url = self._require_env("AURORA_API_URL")

        try:
            self.port = int(self._require_env("AURORA_DASHBOARD_PORT"))
            if not (1 <= self.port <= 65535):
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_DASHBOARD_PORT must be an integer between 1 and 65535.")

    def _require_env(self, key: str) -> str:
        val = os.getenv(key)
        if not val:
            raise ValueError(f"Missing required environment variable '{key}'")
        return val

    def log_summary(self):
        print(f"[aurora-dashboard] Config: env={self.env}, log_level={self.log_level}, listen={self.host}:{self.port}, api_url={self.api_url}")
