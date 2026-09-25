import os
from pathlib import Path
from pydantic import Field, AliasChoices
from pydantic_settings import BaseSettings, SettingsConfigDict

_backend_dir = Path(__file__).resolve().parent.parent
_env_candidates = [
    _backend_dir / ".env",
    _backend_dir.parent / ".env",
    Path(".env"),
]
_env_path = next((p for p in _env_candidates if p.is_file()), _backend_dir / ".env")


class Settings(BaseSettings):
    PROJECT_NAME: str = "Unified Agent Registry & Red Teaming Platform"
    API_V1_STR: str = "/api/v1"

    # Supabase PostgreSQL Database URL
    DATABASE_URL: str = Field(
        default="",
        validation_alias=AliasChoices("DATABASE_URL", "connection_string"),
    )

    # Supabase REST API
    SUPABASE_URL: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_URL", "supabase_url"),
    )
    SUPABASE_SERVICE_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("SUPABASE_SERVICE_KEY", "service_role", "SUPABASE_KEY"),
    )

    # JWT Authentication Secret Key
    JWT_SECRET_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("JWT_SECRET_KEY", "SECRET_KEY"),
    )

    # Groq (LLM Orchestrator + Promptfoo provider)
    GROQ_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("GROQ_API_KEY"),
    )
    GROQ_API_KEYS_POOL: str = Field(
        default="",
        validation_alias=AliasChoices("GROQ_API_KEYS_POOL"),
    )
    GROQ_ENDPOINT: str = Field(
        default="https://api.groq.com/openai/v1",
        validation_alias=AliasChoices("GROQ_ENDPOINT", "OPENAI_CHAT_ENDPOINT"),
    )
    GROQ_MODEL: str = Field(
        default="llama-3.3-70b-versatile",
        validation_alias=AliasChoices("GROQ_MODEL", "OPENAI_CHAT_MODEL"),
    )

    # Ollama (Local evaluator)
    OLLAMA_BASE_URL: str = Field(
        default="http://localhost:11434/v1",
        validation_alias=AliasChoices("OLLAMA_BASE_URL"),
    )
    OLLAMA_MODEL: str = Field(
        default="qwen2.5:3b-instruct",
        validation_alias=AliasChoices("OLLAMA_MODEL"),
    )

    # Google API Key (optional)
    GOOGLE_API_KEY: str = Field(
        default="",
        validation_alias=AliasChoices("GOOGLE_API_KEY"),
    )

    # Temporal
    TEMPORAL_HOST: str = "localhost:7233"
    TEMPORAL_HOST_FALLBACK: str = "localhost:7233"

    # Registry
    ARCTL: str = "/usr/local/bin/arctl"
    DAEMON_URL: str = "http://localhost:12121"
    PASS_RATE_THRESHOLD: float = 0.75

    model_config = SettingsConfigDict(
        env_file=str(_env_path),
        extra="ignore",
    )


settings = Settings()
