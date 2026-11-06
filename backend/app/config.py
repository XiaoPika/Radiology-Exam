from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    # Database (defaults for standalone docker-compose setup)
    db_host: str = "db"
    db_port: int = 3306
    db_user: str = "radiology"
    db_password: str = "radiology123"
    db_name: str = "radiology_exam"

    # Default Superadmin credentials (created on initial startup)
    admin_username: str = "user"
    admin_password: str = "admin"

    # JWT
    secret_key: str = "radiology-exam-secret-key-change-in-production-2026"
    algorithm: str = "HS256"
    access_token_expire_minutes: int = 480  # 8 hours

    # Upload
    upload_max_size_mb: int = 500

    # Data paths
    data_dir: str = "/data"
    dicom_dir: str = "/data/dicom"
    upload_dir: str = "/data/uploads"

    @property
    def database_url(self) -> str:
        return (
            f"mysql+asyncmy://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset=utf8mb4"
        )

    @property
    def database_url_sync(self) -> str:
        return (
            f"mysql+mysqldb://{self.db_user}:{self.db_password}"
            f"@{self.db_host}:{self.db_port}/{self.db_name}"
            f"?charset=utf8mb4"
        )

    class Config:
        env_file = ".env"
        extra = "ignore"


settings = Settings()
