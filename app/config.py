"""Application configuration loaded from environment variables.

API keys are NOT stored server-side — the user supplies their own key in
the web form for every request. The settings below only hold model
identifiers and output-token caps so they can be tuned per deployment.
"""

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    """Runtime configuration for the docx-llm-filler service."""

    # Gemini
    gemini_model: str = "gemini-2.5-flash-lite"
    gemini_max_output_tokens: int = 65536

    # GigaChat (Sber)
    gigachat_model: str = "GigaChat"
    gigachat_max_output_tokens: int = 8000
    gigachat_verify_ssl: bool = True

    # YandexGPT
    yandex_model: str = "yandexgpt-lite/latest"
    yandex_max_output_tokens: int = 8000

    model_config = SettingsConfigDict(
        env_file=".env",
        env_file_encoding="utf-8",
        case_sensitive=False,
        extra="ignore",
    )


def get_settings() -> Settings:
    return Settings()
