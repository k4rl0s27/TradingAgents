"""
OIDC authentication with Authentik (or any OIDC-compatible IdP).

Flow:
1. GET /auth/login          → redirect to Authentik with PKCE
2. GET /auth/callback       → exchange code, validate id_token, upsert user, set session
3. GET /auth/me             → return current user from session
4. POST /auth/logout        → clear session

Uses Starlette SessionMiddleware for cookie-based sessions.
"""

from __future__ import annotations

import hashlib
import logging
import os
import secrets
import time
from urllib.parse import urlencode

import httpx
from jose import jwt
from jose.exceptions import JWTError

logger = logging.getLogger(__name__)

# ── OIDC Config from env ──────────────────────────────────────────────────────

_OIDC_ISSUER = os.environ.get("OIDC_ISSUER", "").rstrip("/")
_OIDC_CLIENT_ID = os.environ.get("OIDC_CLIENT_ID", "")
_OIDC_CLIENT_SECRET = os.environ.get("OIDC_CLIENT_SECRET", "")
_OIDC_REDIRECT_URI = os.environ.get("OIDC_REDIRECT_URI", "")
_OIDC_SCOPES = os.environ.get("OIDC_SCOPES", "openid email profile")

# Discovery cache
_discovery: dict | None = None
_jwks: dict | None = None


def is_configured() -> bool:
    """Whether OIDC is properly configured (all required env vars set)."""
    return bool(_OIDC_ISSUER and _OIDC_CLIENT_ID and _OIDC_CLIENT_SECRET and _OIDC_REDIRECT_URI)


async def _fetch_discovery() -> dict:
    """Fetch and cache the OIDC discovery document."""
    global _discovery
    if _discovery is not None:
        return _discovery
    url = f"{_OIDC_ISSUER}/.well-known/openid-configuration"
    async with httpx.AsyncClient() as client:
        resp = await client.get(url, timeout=15.0)
        resp.raise_for_status()
        _discovery = resp.json()
    logger.info("OIDC discovery loaded from %s", url)
    return _discovery


async def _fetch_jwks() -> dict:
    """Fetch and cache the JWKS document."""
    global _jwks
    if _jwks is not None:
        return _jwks
    disco = await _fetch_discovery()
    jwks_uri = disco["jwks_uri"]
    async with httpx.AsyncClient() as client:
        resp = await client.get(jwks_uri, timeout=15.0)
        resp.raise_for_status()
        _jwks = resp.json()
    return _jwks


# ── PKCE helpers ──────────────────────────────────────────────────────────────

# Pending login challenges live SERVER-SIDE, keyed by the unguessable `state`
# (not in the session cookie): the SPA probes /auth/login and auto-redirects
# to it in quick succession, so two concurrent requests race and the cookie
# that reaches /auth/callback may hold the state of a *different* request
# than the one Authentik honored. Transporting the challenge in the cookie
# then guarantees a state mismatch. A per-process dict sidesteps the cookie
# entirely — fine for the single uvicorn worker this image runs; if the app
# ever scales to multiple workers, move this to a shared store.
_pending_login: dict[str, tuple[str, float]] = {}  # state -> (code_verifier, expires_at)

# How long a login challenge stays valid between /auth/login and /auth/callback.
_PENDING_TTL_SECONDS = 15 * 60


def _purge_expired_logins() -> None:
    now = time.time()
    for state, (_, expires_at) in list(_pending_login.items()):
        if expires_at < now:
            del _pending_login[state]


def _code_challenge(verifier: str) -> str:
    """Compute the S256 PKCE code_challenge for a code_verifier (RFC 7636)."""
    digest = hashlib.sha256(verifier.encode()).digest()
    # Base64url-encode without padding (per RFC 7636 Appendix A)
    return __import__("base64").urlsafe_b64encode(digest).rstrip(b"=").decode()


# ── Public API ────────────────────────────────────────────────────────────────

async def start_login() -> tuple[str, str]:
    """Create a PKCE login challenge and register it server-side.

    Returns ``(authorization_url, state)``. The ``code_verifier`` for the
    ``state`` is kept in ``_pending_login`` until ``resolve_login`` consumes
    it (or the TTL expires), so concurrent duplicate ``/auth/login`` requests
    can each get their own state and the callback still resolves no matter
    which one Authentik honors — no session-cookie round-trip involved.
    """
    _purge_expired_logins()
    state = secrets.token_urlsafe(32)
    code_verifier = secrets.token_urlsafe(64)
    _pending_login[state] = (code_verifier, time.time() + _PENDING_TTL_SECONDS)

    disco = await _fetch_discovery()
    params = {
        "response_type": "code",
        "client_id": _OIDC_CLIENT_ID,
        "redirect_uri": _OIDC_REDIRECT_URI,
        "scope": _OIDC_SCOPES,
        "state": state,
        "code_challenge": _code_challenge(code_verifier),
        "code_challenge_method": "S256",
    }
    auth_url = f"{disco['authorization_endpoint']}?{urlencode(params)}"
    return auth_url, state


async def resolve_login(state: str) -> str | None:
    """Consume a pending login challenge; returns its code_verifier or None.

    The entry is removed on lookup so a given state can complete at most one
    callback (a replay of the same callback then fails cleanly).
    """
    entry = _pending_login.pop(state, None)
    if not entry:
        return None
    code_verifier, expires_at = entry
    if expires_at < time.time():
        return None
    return code_verifier


async def exchange_code(code: str, code_verifier: str) -> dict:
    """Exchange authorization code for tokens. Returns the parsed id_token claims."""
    disco = await _fetch_discovery()
    payload = {
        "grant_type": "authorization_code",
        "code": code,
        "redirect_uri": _OIDC_REDIRECT_URI,
        "client_id": _OIDC_CLIENT_ID,
        "client_secret": _OIDC_CLIENT_SECRET,
        "code_verifier": code_verifier,
    }
    async with httpx.AsyncClient() as client:
        resp = await client.post(
            disco["token_endpoint"],
            data=payload,
            headers={"Content-Type": "application/x-www-form-urlencoded"},
            timeout=15.0,
        )
        resp.raise_for_status()
        tokens = resp.json()
    id_token = tokens.get("id_token")
    if not id_token:
        raise ValueError("No id_token in token response")
    return await validate_id_token(id_token)


async def validate_id_token(token: str) -> dict:
    """Validate an OIDC id_token JWT. Returns the decoded claims on success.

    Uses the issuer from the discovery document (the authoritative source),
    not the raw env var, to avoid trailing-slash and formatting mismatches.
    """
    disco = await _fetch_discovery()
    jwks = await _fetch_jwks()

    # The discovery document's ``issuer`` field is authoritative.
    # Validating against _OIDC_ISSUER directly causes "Invalid issuer" when
    # the user's env var has a trailing slash, a different casing, or uses
    # a slightly different URL than what Authentik puts in the id_token.
    issuer = disco.get("issuer", _OIDC_ISSUER)

    logger.debug("Validating token: expected issuer=%s, audience=%s", issuer, _OIDC_CLIENT_ID)

    try:
        claims = jwt.decode(
            token,
            jwks,
            algorithms=["RS256"],
            audience=_OIDC_CLIENT_ID,
            issuer=issuer,
            options={"verify_exp": True},
        )
    except JWTError as e:
        # Log the actual claim values to help debug mismatches
        unverified = jwt.get_unverified_claims(token)
        logger.warning(
            "Token validation failed: %s. Token iss=%r, expected iss=%r; aud=%r, expected aud=%r",
            e,
            unverified.get("iss"),
            issuer,
            unverified.get("aud"),
            _OIDC_CLIENT_ID,
        )
        raise

    logger.debug("Validated id_token for sub=%s", claims.get("sub"))
    return claims
