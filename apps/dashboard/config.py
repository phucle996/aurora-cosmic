import os

class Config:
    def __init__(self):
        self.env = os.getenv("AURORA_ENV", "development")
        self.log_level = os.getenv("AURORA_LOG_LEVEL", "info")
        self.host = os.getenv("AURORA_DASHBOARD_HOST", "0.0.0.0")
        self.api_url = os.getenv("AURORA_API_URL", "http://go-api:8080")

        try:
            self.port = int(os.getenv("AURORA_DASHBOARD_PORT", "8501"))
            if not (1 <= self.port <= 65535):
                raise ValueError()
        except ValueError:
            raise ValueError("AURORA_DASHBOARD_PORT must be an integer between 1 and 65535.")

    def log_summary(self):
        print(f"[aurora-dashboard] Config: env={self.env}, log_level={self.log_level}, listen={self.host}:{self.port}, api_url={self.api_url}")
