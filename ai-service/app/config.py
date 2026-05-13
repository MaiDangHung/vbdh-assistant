"""Configuration"""

import os
from dataclasses import dataclass


@dataclass
class Settings:
    # AI Model
    ai_api_url: str = os.getenv("AI_API_URL", "http://localhost:11434/v1")
    ai_api_key: str = os.getenv("AI_API_KEY", "ollama")
    ai_model: str = os.getenv("AI_MODEL", "glm-4")

    # Server
    host: str = os.getenv("HOST", "0.0.0.0")
    port: int = int(os.getenv("PORT", "8000"))


settings = Settings()
