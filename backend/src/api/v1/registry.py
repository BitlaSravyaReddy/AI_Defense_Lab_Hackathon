"""
registry.py — Registry pipeline API routes (clone of pipeline.py endpoints).
Exposes kill-switch, artifact listing, and pipeline history.
"""
import json
from datetime import datetime, timezone
from typing import Optional

import httpx
from fastapi import APIRouter
from pydantic import BaseModel

from src.db.supabase_client import db_upsert, db_select, async_db_select, async_db_upsert, _sanitize
from src.config import settings

router = APIRouter(tags=["Registry"])

DAEMON_URL = settings.DAEMON_URL

# In-memory kill-switch state (synced with Supabase on startup)
kill_switches: dict[str, dict] = {}


def sync_kill_switches_from_db():
    """Load kill-switch state from Supabase into memory."""
    db_switches = db_select("kill_switches")
    for s in db_switches:
        name = s.get("name")
        if name:
            kill_switches[name] = {
                "type": s.get("type", "unknown"),
                "enabled": s.get("enabled", True),
                "reason": s.get("reason", ""),
            }


# ── Health ─────────────────────────────────────────────────────────────────────
@router.get("/health")
async def health():
    return {"status": "ok", "time": datetime.now(timezone.utc).isoformat(), "service": settings.PROJECT_NAME}


# ── Artifact Listings (Supabase + daemon proxy) ────────────────────────────────
@router.get("/agents")
async def list_agents():
    daemon_items = []
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{DAEMON_URL}/v0/agents", timeout=2.0)
            if resp.is_success:
                daemon_items = resp.json().get("agents", [])
    except Exception:
        pass

    db_data = await async_db_select("agents")
    db_items = []
    for row in db_data:
        db_items.append({
            "name": row.get("name"),
            "version": row.get("version"),
            "description": row.get("description"),
            "image": row.get("image"),
            "framework": row.get("framework"),
            "language": row.get("language"),
            "modelProvider": row.get("model_provider"),
            "modelName": row.get("model_name"),
        })

    # Merge: daemon items take precedence, DB fills gaps
    seen = {(i.get("name"), i.get("version")) for i in daemon_items}
    for item in db_items:
        if (item.get("name"), item.get("version")) not in seen:
            daemon_items.append(item)

    return _sanitize(daemon_items)


@router.get("/servers")
async def list_servers():
    daemon_items = []
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{DAEMON_URL}/v0/servers", timeout=2.0)
            if resp.is_success:
                daemon_items = resp.json().get("servers", [])
    except Exception:
        pass

    db_data = await async_db_select("mcp_servers")
    seen = {i.get("name") for i in daemon_items}
    for row in db_data:
        if row.get("name") not in seen:
            daemon_items.append({"name": row.get("name"), "version": row.get("version"), "description": row.get("description")})

    return _sanitize(daemon_items)


@router.get("/skills")
async def list_skills():
    db_data = await async_db_select("skills")
    return _sanitize(db_data)


@router.get("/prompts")
async def list_prompts():
    db_data = await async_db_select("prompts")
    return _sanitize(db_data)


# ── Pipeline History ────────────────────────────────────────────────────────────
@router.get("/pipeline/history")
async def get_pipeline_history():
    runs = await async_db_select("pipeline_runs")
    if runs:
        parsed = []
        for r in runs:
            r_copy = dict(r)
            for k in ("files", "stats", "publish_steps", "deployed_versions"):
                if isinstance(r_copy.get(k), str):
                    try:
                        r_copy[k] = json.loads(r_copy[k])
                    except Exception:
                        pass
            parsed.append(r_copy)
        return _sanitize(parsed)
    return []


# ── Kill Switch ────────────────────────────────────────────────────────────────
@router.get("/killswitch")
async def get_kill_switches():
    switches = await async_db_select("kill_switches")
    if switches:
        return _sanitize(switches)
    return _sanitize([{"name": k, **v} for k, v in kill_switches.items()])


@router.get("/killswitch/all")
async def list_kill_switches():
    return await get_kill_switches()


class KillSwitchUpdate(BaseModel):
    name: str
    enabled: bool
    reason: Optional[str] = ""


@router.post("/killswitch/set")
async def set_kill_switch(req: KillSwitchUpdate):
    if req.name not in kill_switches:
        kill_switches[req.name] = {"type": "unknown", "enabled": req.enabled, "reason": req.reason or ""}
    else:
        kill_switches[req.name]["enabled"] = req.enabled
        kill_switches[req.name]["reason"] = req.reason or ""

    await async_db_upsert("kill_switches", {
        "name": req.name,
        "type": kill_switches[req.name].get("type", "unknown"),
        "enabled": req.enabled,
        "reason": req.reason or "",
    }, on_conflict="name")

    return _sanitize({"name": req.name, **kill_switches[req.name]})


# ── Gateway Check ──────────────────────────────────────────────────────────────
@router.get("/gateway/check/{component_name}")
async def gateway_check(component_name: str):
    rows = await async_db_select("kill_switches", match={"name": component_name})
    entry = rows[0] if rows else kill_switches.get(component_name)

    if entry is None:
        return {"name": component_name, "allowed": True, "message": "Component not in kill-switch registry."}

    is_enabled = entry.get("enabled", True)
    comp_type = entry.get("type", "unknown")
    reason = entry.get("reason", "")

    if not is_enabled:
        msg = f"The '{component_name}' function is currently put on hold and cannot take any requests."
        if comp_type == "agent":
            msg = "I'm currently put on hold and cannot take any requests. Please try again later."
        return {"name": component_name, "allowed": False, "message": msg, "reason": reason}

    return {"name": component_name, "allowed": True, "message": "Component is active."}


# ── Deployments (daemon proxy) ─────────────────────────────────────────────────
@router.get("/deployments")
async def list_deployments():
    try:
        async with httpx.AsyncClient() as client:
            resp = await client.get(f"{DAEMON_URL}/v0/deployments", timeout=2.0)
            if resp.is_success:
                return resp.json().get("deployments", [])
    except Exception:
        pass
    return []
