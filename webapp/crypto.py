"""
Cryptography helpers for the TradingAgents webapp.

- Encrypts/decrypts user API keys with Fernet (symmetric AES-128-CBC + HMAC).
- Derives a Fernet key from the SECRET_KEY env var via PBKDF2.

Never log or expose the plaintext key.
"""

from __future__ import annotations

import base64
import hashlib
import os

from cryptography.fernet import Fernet
from cryptography.hazmat.primitives import hashes
from cryptography.hazmat.primitives.kdf.pbkdf2 import PBKDF2HMAC

_SALT = b"tradingagents\x00webapp\x00fernet"  # static — not a secret, just a domain separator


def _get_fernet() -> Fernet:
    """Build a Fernet instance from SECRET_KEY."""
    secret = os.environ.get("SECRET_KEY")
    if not secret:
        raise RuntimeError("SECRET_KEY environment variable is required")
    kdf = PBKDF2HMAC(
        algorithm=hashes.SHA256(),
        length=32,
        salt=_SALT,
        iterations=600_000,
    )
    key = base64.urlsafe_b64encode(kdf.derive(secret.encode()))
    return Fernet(key)


_fernet: Fernet | None = None


def _lazy_fernet() -> Fernet:
    global _fernet
    if _fernet is None:
        _fernet = _get_fernet()
    return _fernet


def encrypt_api_key(plaintext: str) -> str:
    """Encrypt an API key. Returns base64-encoded ciphertext."""
    return _lazy_fernet().encrypt(plaintext.encode()).decode()


def decrypt_api_key(ciphertext: str) -> str:
    """Decrypt an API key. Returns the original plaintext."""
    return _lazy_fernet().decrypt(ciphertext.encode()).decode()
