"""
SimpleFIN service — token claiming, account fetching, and portfolio sync.

Integrates with the SimpleFIN Bridge (https://beta-bridge.simplefin.org/) to
pull brokerage holdings, transactions, and cash balances for a linked account.
"""

from __future__ import annotations

import base64
import logging
import re
from datetime import datetime, timezone

import httpx

from ..crypto import decrypt_api_key, encrypt_api_key
from ..database import get_db

logger = logging.getLogger(__name__)

# Regex to parse transaction descriptions like:
#   "buy 1.069634 shares of Microsoft for $370.22 each"
#   "sell 1.000000 shares of Tesla for $396.00 each"
_TXN_RE = re.compile(
    r"(buy|sell)\s+([\d.]+)\s+shares?\s+of\s+(.+?)\s+for\s+\$([\d.]+)\s+each",
    re.IGNORECASE,
)


# ── Helpers ───────────────────────────────────────────────────────────────────

def _build_ticker_map(holdings: list[dict]) -> dict[str, str]:
    """Build a mapping of company-name → ticker from SimpleFIN holdings data.

    Holdings have both ``description`` (e.g. "NVIDIA Corp") and ``symbol``
    (e.g. "NVDA").  We index by the full lowercased description *and* the
    first word so that partial matches in transaction descriptions work.
    """
    mapping: dict[str, str] = {}
    for h in holdings:
        desc = h.get("description", "")
        symbol = h.get("symbol", "")
        if not desc or not symbol:
            continue
        mapping[desc.lower()] = symbol.upper()
        first_word = desc.split()[0].lower()
        if first_word not in mapping:
            mapping[first_word] = symbol.upper()
    return mapping


def parse_transaction_description(
    description: str, ticker_map: dict[str, str]
) -> dict | None:
    """Parse a SimpleFIN transaction description into structured fields.

    Returns
    -------
    dict with keys ``ticker``, ``transaction_type``, ``quantity``, ``price``,
    ``company_name`` — or ``None`` if the description couldn't be parsed or
    the company name couldn't be mapped to a ticker.
    """
    match = _TXN_RE.search(description)
    if not match:
        return None

    action = match.group(1).lower()  # "buy" or "sell"
    quantity = float(match.group(2))
    company = match.group(3).strip()
    price = float(match.group(4))

    # Resolve ticker from the holdings map
    company_lower = company.lower()
    ticker = ticker_map.get(company_lower)
    if not ticker:
        # Fallback: substring match against known company names
        for name, sym in ticker_map.items():
            if company_lower in name or name in company_lower:
                ticker = sym
                break

    if not ticker:
        logger.warning("Could not map company name '%s' to a ticker", company)
        return None

    return {
        "ticker": ticker,
        "transaction_type": action,
        "quantity": quantity,
        "price": price,
        "company_name": company,
    }


# ── Connection management ─────────────────────────────────────────────────────

async def store_access_url(user_id: int, access_url: str) -> None:
    """Encrypt and persist a SimpleFIN Access URL for *user_id*."""
    encrypted = encrypt_api_key(access_url)
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO simplefin_connections (user_id, access_url_encrypted)
               VALUES (?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
               access_url_encrypted = excluded.access_url_encrypted,
               updated_at = datetime('now')""",
            (user_id, encrypted),
        )
        await db.commit()
    finally:
        await db.close()


async def get_access_url(user_id: int) -> str | None:
    """Retrieve and decrypt the stored Access URL, or *None*."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT access_url_encrypted FROM simplefin_connections WHERE user_id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        if not row:
            return None
        return decrypt_api_key(row["access_url_encrypted"])
    finally:
        await db.close()


async def delete_connection(user_id: int) -> bool:
    """Remove SimpleFIN connection + linked account for *user_id*."""
    db = await get_db()
    try:
        await db.execute(
            "DELETE FROM simplefin_linked_accounts WHERE user_id = ?", (user_id,)
        )
        cursor = await db.execute(
            "DELETE FROM simplefin_connections WHERE user_id = ?", (user_id,)
        )
        await db.commit()
        return cursor.rowcount > 0
    finally:
        await db.close()


# ── SimpleFIN protocol operations ─────────────────────────────────────────────

async def claim_token(base64_token: str) -> str:
    """Base64-decode a SimpleFIN Token and POST to claim the Access URL.

    Returns the Access URL (an HTTPS URL with embedded credentials).
    """
    # Decode
    try:
        claim_url = base64.b64decode(base64_token).decode().strip()
    except Exception:
        raise ValueError("Invalid SimpleFIN Token — could not Base64-decode.") from None

    if not claim_url.startswith("https://"):
        raise ValueError(
            "Decoded token is not an HTTPS URL. The token may be malformed."
        )

    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.post(claim_url)
        if resp.status_code == 403:
            raise ValueError(
                "Token has already been claimed or is invalid. "
                "Your data may be compromised — generate a new token."
            )
        resp.raise_for_status()
        access_url = resp.text.strip()
        if not access_url.startswith("https://"):
            raise ValueError(
                f"Unexpected Access URL returned: {access_url[:80]}..."
            )
        return access_url


async def fetch_accounts(access_url: str) -> list[dict]:
    """Fetch the list of available accounts (balances-only, no transactions)."""
    url = f"{access_url.rstrip('/')}/accounts?balances-only=1"
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code == 403:
            raise PermissionError(
                "Access denied — the SimpleFIN connection may have been revoked."
            )
        resp.raise_for_status()
        data = resp.json()

    accounts = data.get("accounts", [])
    connections = {c["conn_id"]: c for c in data.get("connections", [])}

    result: list[dict] = []
    for acct in accounts:
        conn = connections.get(acct.get("conn_id", ""), {})
        org = acct.get("org", {})
        result.append(
            {
                "account_id": acct.get("id", ""),
                "name": acct.get("name", ""),
                "currency": acct.get("currency", "USD"),
                "org_name": org.get("name", conn.get("org_name", "")),
                "org_domain": org.get("domain", conn.get("org_url", "")),
            }
        )
    return result


async def fetch_account_data(
    access_url: str, account_id: str, start_date_unix: int = 0
) -> dict:
    """Fetch full data (holdings + transactions) for a single account."""
    url = (
        f"{access_url.rstrip('/')}/accounts"
        f"?account={account_id}&start-date={start_date_unix}&pending=1"
    )
    async with httpx.AsyncClient(timeout=30.0, follow_redirects=True) as client:
        resp = await client.get(url)
        if resp.status_code == 403:
            raise PermissionError(
                "Access denied — the SimpleFIN connection may have been revoked."
            )
        resp.raise_for_status()
        data = resp.json()

    accounts = data.get("accounts", [])
    if not accounts:
        raise ValueError("No account data returned from SimpleFIN.")
    return accounts[0]


# ── Linked account management ─────────────────────────────────────────────────

async def link_account(
    user_id: int,
    account_id: str,
    account_name: str,
    org_name: str = "",
    org_domain: str = "",
) -> None:
    """Persist which SimpleFIN account to monitor for *user_id*."""
    db = await get_db()
    try:
        await db.execute(
            """INSERT INTO simplefin_linked_accounts
               (user_id, simplefin_account_id, account_name, org_name, org_domain)
               VALUES (?, ?, ?, ?, ?)
               ON CONFLICT(user_id) DO UPDATE SET
               simplefin_account_id = excluded.simplefin_account_id,
               account_name = excluded.account_name,
               org_name = excluded.org_name,
               org_domain = excluded.org_domain,
               last_synced_at = NULL""",
            (user_id, account_id, account_name, org_name, org_domain),
        )
        await db.commit()
    finally:
        await db.close()


async def get_linked_account(user_id: int) -> dict | None:
    """Return the linked SimpleFIN account row, or *None*."""
    db = await get_db()
    try:
        cursor = await db.execute(
            "SELECT * FROM simplefin_linked_accounts WHERE user_id = ?",
            (user_id,),
        )
        row = await cursor.fetchone()
        return dict(row) if row else None
    finally:
        await db.close()


async def get_connection_status(user_id: int) -> dict:
    """Return the current SimpleFIN connection/link status for the frontend."""
    access_url = await get_access_url(user_id)
    linked = await get_linked_account(user_id)
    return {
        "connected": access_url is not None,
        "linked_account": (
            {
                "account_id": linked["simplefin_account_id"],
                "name": linked["account_name"],
                "org_name": linked.get("org_name", ""),
                "org_domain": linked.get("org_domain", ""),
                "last_synced_at": linked.get("last_synced_at"),
            }
            if linked
            else None
        ),
    }


# ── Portfolio sync ────────────────────────────────────────────────────────────

async def sync_portfolio(user_id: int) -> dict:
    """Pull latest holdings, transactions & cash from SimpleFIN into the DB.

    - Holdings: upserted directly from the SimpleFIN snapshot.
    - Transactions: new ones inserted (deduped by ``simplefin_transaction_id``).
    - Cash balance: the ``available-balance`` is recorded as a new row.
    """
    access_url = await get_access_url(user_id)
    if not access_url:
        raise ValueError("No SimpleFIN connection. Connect first.")

    linked = await get_linked_account(user_id)
    if not linked:
        raise ValueError("No linked account. Select an account to monitor first.")

    account_id = linked["simplefin_account_id"]

    # Determine how far back to pull transactions.
    # First sync (no last_synced_at): pull full 90 days from SimpleFIN.
    # Subsequent syncs: pull only transactions since the last sync.
    last_synced = linked.get("last_synced_at")
    start_unix = (
        int(datetime.fromisoformat(last_synced).timestamp()) if last_synced else 0
    )

    account_data = await fetch_account_data(access_url, account_id, start_unix)

    holdings_data: list[dict] = account_data.get("holdings", [])
    transactions_data: list[dict] = account_data.get("transactions", [])

    # Build ticker map from current holdings for transaction-parsing
    ticker_map = _build_ticker_map(holdings_data)

    db = await get_db()
    try:
        # ── Sync holdings (snapshot replacement) ──
        for h in holdings_data:
            ticker = h.get("symbol", "").upper()
            shares = float(h.get("shares", 0))
            purchase_price = (
                float(h.get("purchase_price", 0))
                if h.get("purchase_price")
                else None
            )
            sf_holding_id = h.get("id", "")

            if not ticker or shares <= 0:
                continue

            await db.execute(
                """INSERT INTO holdings
                   (user_id, ticker, asset_type, quantity, avg_cost, source, simplefin_holding_id)
                   VALUES (?, ?, 'stock', ?, ?, 'simplefin', ?)
                   ON CONFLICT(user_id, ticker) DO UPDATE SET
                   quantity = excluded.quantity,
                   avg_cost = excluded.avg_cost,
                   asset_type = excluded.asset_type,
                   source = 'simplefin',
                   simplefin_holding_id = excluded.simplefin_holding_id,
                   updated_at = datetime('now')""",
                (user_id, ticker, shares, purchase_price, sf_holding_id),
            )

        # ── Sync transactions — insert new ones, skip already-imported ──
        new_tx_count = 0
        for txn in transactions_data:
            sf_txn_id = txn.get("id", "")
            if not sf_txn_id:
                continue

            # Skip if this SimpleFIN transaction was already imported
            cursor = await db.execute(
                "SELECT id FROM transactions WHERE user_id = ? AND simplefin_transaction_id = ?",
                (user_id, sf_txn_id),
            )
            if await cursor.fetchone():
                continue

            description = txn.get("description", "")
            parsed = parse_transaction_description(description, ticker_map)
            if not parsed:
                continue

            posted_ts = txn.get("posted", 0)
            date_str = (
                datetime.fromtimestamp(posted_ts, tz=timezone.utc).strftime("%Y-%m-%d")
                if posted_ts
                else datetime.now(timezone.utc).strftime("%Y-%m-%d")
            )

            total_amount = abs(float(txn.get("amount", 0)))

            await db.execute(
                """INSERT INTO transactions
                   (user_id, ticker, transaction_type, quantity, price,
                    total_amount, fees, date, notes, source, simplefin_transaction_id)
                   VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?, 'simplefin', ?)""",
                (
                    user_id,
                    parsed["ticker"],
                    parsed["transaction_type"],
                    parsed["quantity"],
                    parsed["price"],
                    total_amount,
                    date_str,
                    description,
                    sf_txn_id,
                ),
            )
            new_tx_count += 1

        # ── Sync cash balance ──
        available_balance = float(account_data.get("available-balance", 0))
        balance_date_ts = account_data.get("balance-date", 0)
        balance_date = (
            datetime.fromtimestamp(balance_date_ts, tz=timezone.utc).strftime(
                "%Y-%m-%d"
            )
            if balance_date_ts
            else datetime.now(timezone.utc).strftime("%Y-%m-%d")
        )

        await db.execute(
            "INSERT INTO cash_balance (user_id, amount, date, notes) VALUES (?, ?, ?, ?)",
            (user_id, available_balance, balance_date, "Synced from SimpleFIN"),
        )

        # ── Update last-synced timestamp ──
        now_str = datetime.now(timezone.utc).isoformat()
        await db.execute(
            "UPDATE simplefin_linked_accounts SET last_synced_at = ? WHERE user_id = ?",
            (now_str, user_id),
        )

        await db.commit()

        logger.info(
            "SimpleFIN sync complete for user %d: %d holdings, %d new txns, cash=%.2f",
            user_id,
            len(holdings_data),
            new_tx_count,
            available_balance,
        )

        return {
            "holdings_synced": len(holdings_data),
            "transactions_synced": new_tx_count,
            "cash_balance": available_balance,
            "last_synced_at": now_str,
        }
    finally:
        await db.close()
