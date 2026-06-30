"""
User service — CRUD for users and their LLM provider settings.

API keys are encrypted at rest via webapp.crypto.
"""

from __future__ import annotations

from typing import Optional

from ..crypto import encrypt_api_key, decrypt_api_key
from ..database import get_db


# ── Users ─────────────────────────────────────────────────────────────────────

async def upsert_user(sub: str, email: str | None = None, name: str | None = None) -> dict:
    """Create or update a user from OIDC claims. Returns the user dict."""
    db = await get_db()
    try:
        existing = await db.execute(
            "SELECT * FROM users WHERE oidc_sub = ?", (sub,)
        )
        row = await existing.fetchone()
        if row:
            await db.execute(
                """UPDATE users SET email = ?, display_name = ?, updated_at = datetime('now')
                   WHERE oidc_sub = ?""",
                (email, name, sub),
            )
        else:
            await db.execute(
                """INSERT INTO users (oidc_sub, email, display_name)
                   VALUES (?, ?, ?)""",
                (sub, email, name),
            )
        await db.commit()

        cursor = await db.execute("SELECT * FROM users WHERE oidc_sub = ?", (sub,))
        return dict(await cursor.fetchone())
    finally:
        await db.close()


async def get_user_by_id(user_id: int) -> dict | None:
    """Get a user by their internal id."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE id = ?", (user_id,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_user_by_sub(sub: str) -> dict | None:
    """Get a user by their OIDC sub claim."""
    db = await get_db()
    try:
        cursor = await db.execute("SELECT * FROM users WHERE oidc_sub = ?", (sub,))
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


# ── User Settings ─────────────────────────────────────────────────────────────

async def get_user_settings(user_id: int) -> dict | None:
    """Get saved LLM settings for a user. API key is returned decrypted."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM user_settings WHERE user_id = ?", (user_id,)
        )
        row = await cursor.fetchone()
        if not row:
            return None
        result = dict(row)
        result["api_key"] = decrypt_api_key(result["encrypted_api_key"])
        return result
    finally:
        await db.close()


async def save_user_settings(
    user_id: int,
    llm_provider: str,
    api_key: str,
    deep_think_llm: str | None = None,
    quick_think_llm: str | None = None,
    backend_url: str | None = None,
    temperature: float | None = None,
    google_thinking_level: str | None = None,
    openai_reasoning_effort: str | None = None,
    anthropic_effort: str | None = None,
) -> dict:
    """Save or update user LLM settings. API key is encrypted before storage."""
    encrypted = encrypt_api_key(api_key)
    db = await get_db()
    try:
        existing = await db.execute(
            "SELECT id FROM user_settings WHERE user_id = ?", (user_id,)
        )
        row = await existing.fetchone()
        if row:
            await db.execute(
                """UPDATE user_settings
                   SET llm_provider = ?, deep_think_llm = ?, quick_think_llm = ?,
                       backend_url = ?, encrypted_api_key = ?, temperature = ?,
                       google_thinking_level = ?, openai_reasoning_effort = ?,
                       anthropic_effort = ?, updated_at = datetime('now')
                   WHERE user_id = ?""",
                (llm_provider, deep_think_llm, quick_think_llm, backend_url,
                 encrypted, temperature, google_thinking_level,
                 openai_reasoning_effort, anthropic_effort, user_id),
            )
        else:
            await db.execute(
                """INSERT INTO user_settings
                   (user_id, llm_provider, deep_think_llm, quick_think_llm,
                    backend_url, encrypted_api_key, temperature,
                    google_thinking_level, openai_reasoning_effort, anthropic_effort)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)""",
                (user_id, llm_provider, deep_think_llm, quick_think_llm,
                 backend_url, encrypted, temperature, google_thinking_level,
                 openai_reasoning_effort, anthropic_effort),
            )
        await db.commit()

        # Mark user as initialized
        await db.execute(
            "UPDATE users SET is_initialized = 1, updated_at = datetime('now') WHERE id = ?",
            (user_id,),
        )
        await db.commit()

        return await get_user_settings(user_id)
    finally:
        await db.close()


async def get_user_llm_config(user_id: int) -> dict:
    """Get the LLM configuration dict ready to merge into DEFAULT_CONFIG.

    Returns an empty dict if the user hasn't set up yet.
    """
    settings = await get_user_settings(user_id)
    if not settings:
        return {}
    return {
        "llm_provider": settings["llm_provider"],
        "deep_think_llm": settings.get("deep_think_llm"),
        "quick_think_llm": settings.get("quick_think_llm"),
        "backend_url": settings.get("backend_url"),
        "api_key": settings["api_key"],
        "temperature": settings.get("temperature"),
        "google_thinking_level": settings.get("google_thinking_level"),
        "openai_reasoning_effort": settings.get("openai_reasoning_effort"),
        "anthropic_effort": settings.get("anthropic_effort"),
    }
