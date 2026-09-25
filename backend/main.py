"""
main.py — Agent Registry & Red Teaming Platform
FastAPI application on port 8050.

Combines:
- Agent Registry Pipeline (arctl publish, kill-switch, artifact catalog)
- Red Teaming System (DeepTeam/PromptFoo attacks, Temporal workflows, SSE streaming)

"""
import asyncio
import threading
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqlalchemy import text

from src.config import settings
from src.db.session import engine, Base, SessionLocal
import src.db.models  # ensure all models are registered

from src.api.v1.router import api_v1_router
from src.api.v1.registry import sync_kill_switches_from_db


# ── DB Init & Migrations ───────────────────────────────────────────────────────
def init_db_and_migrations():
    """Initialize all tables and apply incremental ALTER TABLE migrations."""
    try:
        Base.metadata.create_all(bind=engine)
        statements = [
            # Red-team agent columns
            "ALTER TABLE redteam_agents ADD COLUMN IF NOT EXISTS user_id VARCHAR;",
            "ALTER TABLE redteam_agents ADD COLUMN IF NOT EXISTS name VARCHAR;",
            "ALTER TABLE redteam_agents ADD COLUMN IF NOT EXISTS schedule_interval_minutes INTEGER DEFAULT 60;",
            "ALTER TABLE redteam_agents ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE redteam_agents ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMP;",
            "ALTER TABLE redteam_agents ADD COLUMN IF NOT EXISTS sync_source VARCHAR DEFAULT 'unified';",
            # Registered agents columns
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS user_id VARCHAR;",
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS name VARCHAR;",
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS schedule_interval_minutes INTEGER DEFAULT 60;",
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS is_active BOOLEAN DEFAULT TRUE;",
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS last_evaluated_at TIMESTAMP;",
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS sync_source VARCHAR DEFAULT 'unified';",
            "ALTER TABLE registered_agents ADD COLUMN IF NOT EXISTS last_registry_version VARCHAR;",
            # Sessions
            "ALTER TABLE redteam_sessions ADD COLUMN IF NOT EXISTS user_id VARCHAR;",
            "ALTER TABLE redteam_sessions ADD COLUMN IF NOT EXISTS batch_id VARCHAR;",
            "ALTER TABLE redteam_sessions ADD COLUMN IF NOT EXISTS trigger_type VARCHAR DEFAULT 'manual';",
            # Notifications
            "ALTER TABLE notifications ADD COLUMN IF NOT EXISTS user_id VARCHAR;",
        ]
        with engine.begin() as conn:
            for stmt in statements:
                try:
                    conn.execute(text(stmt))
                except Exception:
                    pass
        print("✅ [DB] Tables & migrations applied.")
    except Exception as e:
        print(f"⚠️ [DB] Init note: {e}")


# ── arctl daemon ───────────────────────────────────────────────────────────────
async def _start_arctl_daemon():
    """Best-effort: start arctl daemon for registry publish operations."""
    import asyncio as _a
    try:
        proc = await _a.create_subprocess_exec(
            settings.ARCTL, "daemon", "start",
            stdout=_a.subprocess.PIPE,
            stderr=_a.subprocess.PIPE,
        )
        _, err = await proc.communicate()
        print(f"[arctl] daemon start → {proc.returncode}: {err.decode().strip()[:100]}")
    except Exception as e:
        print(f"[arctl] daemon start error (non-fatal): {e}")


# ── Temporal Worker ────────────────────────────────────────────────────────────
def _start_temporal_worker_thread():
    """Run Temporal worker in background daemon thread with host fallback."""
    import asyncio as _a
    from src.workers.temporal_worker import start_worker
    loop = _a.new_event_loop()
    _a.set_event_loop(loop)
    try:
        loop.run_until_complete(start_worker())
    except Exception as e:
        print(f"[Temporal Worker] Error: {e} — worker not started.")


async def _sync_all_agent_schedules():
    """Restore Temporal Schedules for all active registered agents on startup."""
    await asyncio.sleep(3)
    try:
        from src.db.models import RegisteredAgentEntity
        from src.services.temporal_scheduler import create_agent_schedule

        db = SessionLocal()
        agents = db.query(RegisteredAgentEntity).filter(
            RegisteredAgentEntity.is_active == True
        ).all()

        synced = 0
        for ra in agents:
            try:
                payload = {
                    "endpoint_url": ra.target_url, "agent_type": ra.agent_type,
                    "domain": ra.domain, "sensitivity": ra.sensitivity,
                    "processes_pii": ra.processes_pii, "handles_financial": ra.handles_financial,
                    "handles_medical": ra.handles_medical, "has_mcp": ra.has_mcp,
                    "modalities": ra.modalities or ["text"],
                    "deployment_countries": ra.deployment_countries or ["us"],
                    "tasks_description": ra.tasks_description or "",
                }
                await create_agent_schedule(ra.id, ra.schedule_interval_minutes or 60, payload)
                synced += 1
            except Exception as e:
                print(f"[Startup Sync] Schedule note for {ra.id}: {e}")
        db.close()
        print(f"✅ [Startup Sync] Restored {synced} Temporal Schedules.")
    except Exception as e:
        print(f"⚠️ [Startup Sync] Error: {e}")


# ── Lifespan ───────────────────────────────────────────────────────────────────
@asynccontextmanager
async def lifespan(app: FastAPI):
    # 1. DB in background thread (non-blocking)
    threading.Thread(target=init_db_and_migrations, daemon=True, name="db-init").start()

    # 2. Load kill-switch state from Supabase
    try:
        sync_kill_switches_from_db()
    except Exception as e:
        print(f"[KillSwitch] Sync error (non-fatal): {e}")

    # 3. arctl daemon (best-effort)
    asyncio.create_task(_start_arctl_daemon())

    # 4. Temporal worker thread
    t = threading.Thread(target=_start_temporal_worker_thread, daemon=True, name="temporal-worker")
    t.start()
    print("[Temporal] Worker thread started.")

    # 5. Restore agent schedules
    asyncio.create_task(_sync_all_agent_schedules())

    yield
    print("[Unified Platform] Shutting down.")


# ── App ────────────────────────────────────────────────────────────────────────
app = FastAPI(
    title=settings.PROJECT_NAME,
    version="1.0.0",
    description="Unified Agent Registry + Red Teaming Platform",
    docs_url="/docs",
    redoc_url="/redoc",
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Mount routes at both /api/v1 and /api (legacy compat)
app.include_router(api_v1_router, prefix="/api/v1")
app.include_router(api_v1_router, prefix="/api")


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "service": settings.PROJECT_NAME,
        "version": "1.0.0",
        "arctl": settings.ARCTL,
        "temporal_primary": settings.TEMPORAL_HOST,
        "temporal_fallback": settings.TEMPORAL_HOST_FALLBACK,
    }


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8050, reload=False)
