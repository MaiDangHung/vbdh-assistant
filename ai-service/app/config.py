from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    """Configuration - dùng chung GLM API với tbkl-hoatien"""

    # GLM Config (z.ai) — Anthropic-compatible endpoint
    glm_api_key: str = "your-glm-api-key"
    glm_base_url: str = "https://api.z.ai/api/anthropic"

    # Model
    ai_model: str = "glm-4.5-air"  # Fast, phù hợp cho tóm tắt văn bản

    # Server
    host: str = "0.0.0.0"
    port: int = 8000

    class Config:
        env_file = ".env"


settings = Settings()
