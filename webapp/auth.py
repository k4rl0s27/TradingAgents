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

def _generate_pkce_pair() -> tuple[str, str]:
    """Generate a PKCE code_verifier and code_challenge (S256)."""
    code_verifier = secrets.token_urlsafe(64)
    digest = hashlib.sha256(code_verifier.encode()).digest()
    # Base64url-encode without padding (per RFC 7636 Appendix A)
    code_challenge = (
        __import__("base64").urlsafe_b64encode(digest).rstrip(b"=").decode()
    )
    return code_verifier, code_challenge


# ── Public API ────────────────────────────────────────────────────────────────

async def get_authorization_url() -> tuple[str, str]:
    """Build the Authentik authorization URL with PKCE.

    Returns (url, code_verifier).  The caller must stash code_verifier in the
    session so it's available in the callback.
    """
    disco = await _fetch_discovery()
    code_verifier, code_challenge = _generate_pkce_pair()
    state = secrets.token_urlsafe(32)
    params = {
        "response_type": "code",
        "client_id": _OIDC_CLIENT_ID,
        "redirect_uri": _OIDC_REDIRECT_URI,
        "scope": _OIDC_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{disco['authorization_endpoint']}?{urlencode(params)}"
    return auth_url, code_verifier


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


async def get_authorization_url_simple() -> tuple[str, str, str]:
    """Build the authorization URL and return (url, code_verifier, state)."""
    disco = await _fetch_discovery()
    code_verifier, code_challenge = _generate_pkce_pair()
    state = secrets.token_urlsafe(32)
    params = {
        "response_type": "code",
        "client_id": _OIDC_CLIENT_ID,
        "redirect_uri": _OIDC_REDIRECT_URI,
        "scope": _OIDC_SCOPES,
        "state": state,
        "code_challenge": code_challenge,
        "code_challenge_method": "S256",
    }
    auth_url = f"{disco['authorization_endpoint']}?{urlencode(params)}"
    return auth_url, code_verifier, state
