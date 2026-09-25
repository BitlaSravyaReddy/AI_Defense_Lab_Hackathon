"""
supabase_client.py — Supabase REST client for registry-side operations.
Used by registry_publisher and registry API routes to read/write the
agents, mcp_servers, skills, prompts, pipeline_runs, kill_switches tables
via the Supabase PostgREST interface (same approach as pipeline.py).
"""
import asyncio
from datetime import date as _date, datetime as _datetime
from typing import Optional

from src.config import settings

try:
    from supabase import create_client, Client as SupabaseClient
    _supabase: Optional[SupabaseClient] = create_client(
        settings.SUPABASE_URL,
        settings.SUPABASE_SERVICE_KEY,
    )
    print("[Supabase] Client initialized.")
except Exception as _err:
    _supabase = None
    print(f"[Supabase] Init failed: {_err}")


def _sanitize(obj):
    """Recursively convert datetime/date to ISO strings for JSON serialisation."""
    if isinstance(obj, (_datetime, _date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _sanitize(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_sanitize(i) for i in obj]
    return obj


def db_upsert(table: str, data: dict | list[dict], on_conflict: Optional[str] = None) -> None:
    if not _supabase:
        return
    try:
        q = _supabase.table(table)
        if on_conflict:
            q.upsert(data, on_conflict=on_conflict).execute()
        else:
            q.upsert(data).execute()
    except Exception as ex:
        print(f"[Supabase] upsert '{table}': {ex}")


def db_select(table: str, match: Optional[dict] = None) -> list[dict]:
    if not _supabase:
        return []
    try:
        q = _supabase.table(table).select("*")
        if match:
            q = q.match(match)
        res = q.execute()
        return _sanitize(res.data or [])
    except Exception as ex:
        print(f"[Supabase] select '{table}': {ex}")
        return []


async def async_db_upsert(table: str, data: dict | list[dict], on_conflict: Optional[str] = None):
    return await asyncio.to_thread(db_upsert, table, data, on_conflict)


async def async_db_select(table: str, match: Optional[dict] = None) -> list[dict]:
    return await asyncio.to_thread(db_select, table, match)
