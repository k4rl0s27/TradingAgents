"""
Settings routes — user LLM provider configuration (setup wizard API).
"""

from __future__ import annotations

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field

from ..routers.auth import get_current_user
from ..services import user_service
from tradingagents.llm_clients.model_catalog import get_model_options

router = APIRouter(prefix="/api/settings", tags=["settings"])


# ── Pydantic models ───────────────────────────────────────────────────────────

class ProviderOption(BaseModel):
    key: str
    display_name: str
    env_var: str | None = None  # which env var holds the API key


class ProviderListResponse(BaseModel):
    providers: list[ProviderOption]


class ModelOption(BaseModel):
    display: str
    value: str


class ProviderModelsResponse(BaseModel):
    provider: str
    deep_models: list[ModelOption]
    quick_models: list[ModelOption]


class InitializeRequest(BaseModel):
    llm_provider: str = Field(..., min_length=1, max_length=50)
    api_key: str = Field(..., min_length=1)
    deep_think_llm: str | None = None
    quick_think_llm: str | None = None
    backend_url: str | None = None
    temperature: float | None = None
    google_thinking_level: str | None = None
    openai_reasoning_effort: str | None = None
    anthropic_effort: str | None = None


class SettingsResponse(BaseModel):
    llm_provider: str
    deep_think_llm: str | None
    quick_think_llm: str | None
    backend_url: str | None
    api_key_masked: str  # e.g. "sk-...xyz"
    temperature: float | None
    google_thinking_level: str | None
    openai_reasoning_effort: str | None
    anthropic_effort: str | None


# ── Provider listing ──────────────────────────────────────────────────────────

# Canonical provider list for the setup wizard UI
_PROVIDERS: list[ProviderOption] = [
    ProviderOption(key="openai", display_name="OpenAI", env_var="OPENAI_API_KEY"),
    ProviderOption(key="anthropic", display_name="Anthropic", env_var="ANTHROPIC_API_KEY"),
    ProviderOption(key="google", display_name="Google Gemini", env_var="GOOGLE_API_KEY"),
    ProviderOption(key="deepseek", display_name="DeepSeek", env_var="DEEPSEEK_API_KEY"),
    ProviderOption(key="xai", display_name="xAI (Grok)", env_var="XAI_API_KEY"),
    ProviderOption(key="qwen", display_name="Qwen (Intl)", env_var="DASHSCOPE_API_KEY"),
    ProviderOption(key="qwen-cn", display_name="Qwen (China)", env_var="DASHSCOPE_CN_API_KEY"),
    ProviderOption(key="glm", display_name="GLM (Intl)", env_var="ZHIPU_API_KEY"),
    ProviderOption(key="glm-cn", display_name="GLM (China)", env_var="ZHIPU_CN_API_KEY"),
    ProviderOption(key="minimax", display_name="MiniMax (Intl)", env_var="MINIMAX_API_KEY"),
    ProviderOption(key="minimax-cn", display_name="MiniMax (China)", env_var="MINIMAX_CN_API_KEY"),
    ProviderOption(key="mistral", display_name="Mistral", env_var="MISTRAL_API_KEY"),
    ProviderOption(key="kimi", display_name="Kimi (Moonshot)", env_var="MOONSHOT_API_KEY"),
    ProviderOption(key="groq", display_name="Groq", env_var="GROQ_API_KEY"),
    ProviderOption(key="nvidia", display_name="NVIDIA NIM", env_var="NVIDIA_API_KEY"),
    ProviderOption(key="openrouter", display_name="OpenRouter", env_var="OPENROUTER_API_KEY"),
    ProviderOption(key="bedrock", display_name="Amazon Bedrock", env_var=None),
    ProviderOption(key="ollama", display_name="Ollama (Local)", env_var=None),
    ProviderOption(key="openai_compatible", display_name="OpenAI-Compatible", env_var="OPENAI_COMPATIBLE_API_KEY"),
]


# ── Routes ────────────────────────────────────────────────────────────────────

@router.get("/providers", response_model=ProviderListResponse)
async def list_providers():
    """Get the list of supported LLM providers for the setup wizard."""
    return ProviderListResponse(providers=_PROVIDERS)


@router.get("/providers/{provider}/models", response_model=ProviderModelsResponse)
async def get_provider_models(provider: str):
    """Get available deep and quick thinking models for a provider."""
    try:
        deep_opts = get_model_options(provider, "deep")
        quick_opts = get_model_options(provider, "quick")
    except Exception:
        deep_opts = []
        quick_opts = []

    return ProviderModelsResponse(
        provider=provider,
        deep_models=[ModelOption(display=d, value=v) for d, v in deep_opts],
        quick_models=[ModelOption(display=d, value=v) for d, v in quick_opts],
    )


@router.post("/initialize", response_model=SettingsResponse)
async def initialize_settings(
    body: InitializeRequest,
    user: dict = Depends(get_current_user),
):
    """Save the user's LLM provider and API key (setup wizard completion)."""
    settings = await user_service.save_user_settings(
        user_id=user["id"],
        llm_provider=body.llm_provider,
        api_key=body.api_key,
        deep_think_llm=body.deep_think_llm,
        quick_think_llm=body.quick_think_llm,
        backend_url=body.backend_url,
        temperature=body.temperature,
        google_thinking_level=body.google_thinking_level,
        openai_reasoning_effort=body.openai_reasoning_effort,
        anthropic_effort=body.anthropic_effort,
    )
    key = settings["api_key"]
    masked = key[:3] + "..." + key[-4:] if len(key) > 8 else "****"
    return SettingsResponse(
        llm_provider=settings["llm_provider"],
        deep_think_llm=settings.get("deep_think_llm"),
        quick_think_llm=settings.get("quick_think_llm"),
        backend_url=settings.get("backend_url"),
        api_key_masked=masked,
        temperature=settings.get("temperature"),
        google_thinking_level=settings.get("google_thinking_level"),
        openai_reasoning_effort=settings.get("openai_reasoning_effort"),
        anthropic_effort=settings.get("anthropic_effort"),
    )


@router.get("", response_model=SettingsResponse | None)
async def get_settings(user: dict = Depends(get_current_user)):
    """Get the current user's saved settings (API key masked)."""
    settings = await user_service.get_user_settings(user["id"])
    if not settings:
        return None
    key = settings["api_key"]
    masked = key[:3] + "..." + key[-4:] if len(key) > 8 else "****"
    return SettingsResponse(
        llm_provider=settings["llm_provider"],
        deep_think_llm=settings.get("deep_think_llm"),
        quick_think_llm=settings.get("quick_think_llm"),
        backend_url=settings.get("backend_url"),
        api_key_masked=masked,
        temperature=settings.get("temperature"),
        google_thinking_level=settings.get("google_thinking_level"),
        openai_reasoning_effort=settings.get("openai_reasoning_effort"),
        anthropic_effort=settings.get("anthropic_effort"),
    )


@router.put("", response_model=SettingsResponse)
async def update_settings(
    body: InitializeRequest,
    user: dict = Depends(get_current_user),
):
    """Update the user's LLM settings."""
    settings = await user_service.save_user_settings(
        user_id=user["id"],
        llm_provider=body.llm_provider,
        api_key=body.api_key,
        deep_think_llm=body.deep_think_llm,
        quick_think_llm=body.quick_think_llm,
        backend_url=body.backend_url,
        temperature=body.temperature,
        google_thinking_level=body.google_thinking_level,
        openai_reasoning_effort=body.openai_reasoning_effort,
        anthropic_effort=body.anthropic_effort,
    )
    key = settings["api_key"]
    masked = key[:3] + "..." + key[-4:] if len(key) > 8 else "****"
    return SettingsResponse(
        llm_provider=settings["llm_provider"],
        deep_think_llm=settings.get("deep_think_llm"),
        quick_think_llm=settings.get("quick_think_llm"),
        backend_url=settings.get("backend_url"),
        api_key_masked=masked,
        temperature=settings.get("temperature"),
        google_thinking_level=settings.get("google_thinking_level"),
        openai_reasoning_effort=settings.get("openai_reasoning_effort"),
        anthropic_effort=settings.get("anthropic_effort"),
    )
