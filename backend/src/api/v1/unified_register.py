"""
unified_register.py — THE core unified endpoint.
POST /api/v1/agents/unified-register

Flow:
1. Accept GitHub repo URL, branch, name overrides, red-team profile fields,
   schedule interval, and optional result files (informational only — no gate).
2. resolve_location() + publish_all() → arctl build + registry publish.
3. Write AgentVersionEventEntity row.
4. Create RegisteredAgentEntity + AgentEntity + SessionEntity.
5. Create Temporal Schedule for periodic evaluation.
6. Launch RedTeamWorkflow immediately.
7. Return unified response with run details + session_id.
"""
import json
import uuid
import asyncio
from datetime import datetime, timezone
from typing import Optional, List

from fastapi import APIRouter, Depends, Form, File, UploadFile, HTTPException, BackgroundTasks
from fastapi.responses import JSONResponse
from sqlalchemy.orm import Session
from pydantic import BaseModel

from src.db.session import get_db
from src.db.models import (
    RegisteredAgentEntity, AgentEntity, SessionEntity, AgentVersionEventEntity
)
from src.db.supabase_client import db_upsert, async_db_upsert, _sanitize
from src.api.v1.auth import get_current_user_optional
from src.config import settings
from src.services.registry_publisher import (
    parse_results, compute_pass_rate, resolve_location, publish_all
)

router = APIRouter(prefix="/agents", tags=["Unified Register"])


class UnifiedRegisterResponse(BaseModel):
    session_id: str
    agent_id: str
    registry_status: str           # "PUBLISHED" | "PARTIAL" | "REJECTED" | "FAILED"
    redteam_status: str            # "launched" | "skipped"
    pass_rate_pct: float
    threshold_pct: int
    passed_threshold: bool
    message: str
    publish_steps: list = []
    deployed_versions: dict = {}


@router.post("/unified-register")
async def unified_register(
    background_tasks: BackgroundTasks,
    # ── Registry fields ──────────────────────────────────────────────────────
    repo_url: str = Form(..., description="GitHub repo URL or local path"),
    branch: str = Form("main", description="Git branch"),
    agent_name_override: Optional[str] = Form(None),
    server_name_override: Optional[str] = Form(None),
    skill_names_override: Optional[str] = Form(None),
    prompt_names_override: Optional[str] = Form(None),
    # ── Red-team profile fields ──────────────────────────────────────────────
    agent_display_name: str = Form("AI Agent"),
    endpoint_url: str = Form(..., description="HTTP endpoint of the running agent"),
    agent_type: str = Form("rag"),
    domain: str = Form("general"),
    sensitivity: str = Form("medium"),
    processes_pii: bool = Form(False),
    handles_financial: bool = Form(False),
    handles_medical: bool = Form(False),
    has_mcp: bool = Form(False),
    mcp_tools_csv: Optional[str] = Form(""),
    tasks_description: str = Form(...),
    deployment_countries_csv: str = Form("us"),
    modalities_csv: str = Form("text"),
    is_public_facing: bool = Form(True),
    schedule_interval_minutes: int = Form(60),
    arch_code: Optional[str] = Form(""),
    arch_type: Optional[str] = Form("plantuml"),
    dataflow_code: Optional[str] = Form(""),
    dataflow_type: Optional[str] = Form("plantuml"),
    has_own_threat_model: bool = Form(False),
    # ── Pass-rate gate ───────────────────────────────────────────────────────
    result_files: List[UploadFile] = File(default=[]),
    threat_model_file: Optional[UploadFile] = File(default=None),
    # ── Auth ─────────────────────────────────────────────────────────────────
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    ts = datetime.now(timezone.utc).isoformat()
    run_ts_compact = datetime.fromisoformat(ts).strftime("%Y%m%d%H%M%S")
    user_id = current_user.id if current_user else None

    # ── Step 1: Parse result files (informational only — no gate) ────────────
    all_cases = []
    file_errors = []

    for f in result_files:
        content = await f.read()
        try:
            cases = parse_results(content, f.filename or "results.json")
            all_cases.extend(cases)
        except Exception as ex:
            file_errors.append({"file": f.filename, "error": str(ex)})

    stats = compute_pass_rate(all_cases) if all_cases else {"total": 0, "evaluated": 0, "passed": 0, "rate": 1.0}
    pass_rate_pct = round(stats["rate"] * 100, 1)

    # ── Step 2: Registry publish (arctl) ──────────────────────────────────────
    name_overrides = {
        "agent_name": agent_name_override,
        "server_name": server_name_override,
        "skill_names": skill_names_override,
        "prompt_names": prompt_names_override,
    }

    publish_steps = []
    deployed_versions = {}
    registry_safe_name = None
    registry_agent_version = None
    registry_status = "FAILED"

    try:
        resolved_path = await asyncio.shield(resolve_location(repo_url, branch, "project"))
        steps, deployed_versions, registry_safe_name, registry_agent_version = await asyncio.shield(
            publish_all(resolved_path, name_overrides, run_ts=run_ts_compact)
        )
        publish_steps = steps
        any_failed = any(s.get("returncode", 0) != 0 for s in steps)
        registry_status = "PUBLISHED" if not any_failed else "PARTIAL"
    except asyncio.CancelledError:
        # Request was cancelled mid-flight — publish may still be running; treat as partial
        registry_status = "PARTIAL"
        publish_steps = [{"cmd": "checkout/publish", "returncode": 0, "stderr": "", "stdout": "[shielded — still running in background]"}]
    except Exception as ex:
        registry_status = "FAILED"
        publish_steps = [{"cmd": "checkout/publish", "returncode": -1, "stderr": str(ex), "stdout": ""}]

    # Persist pipeline run to Supabase
    await async_db_upsert("pipeline_runs", _sanitize({
        "id": ts,
        "status": registry_status,
        "pass_rate_pct": pass_rate_pct,
        "location": repo_url,
        "branch": branch,
        "agent_name": agent_name_override,
        "server_name": server_name_override,
        "timestamp": ts,
        "run_ts": run_ts_compact,
        "files": json.dumps([f.filename for f in result_files]),
        "stats": json.dumps(_sanitize(stats)),
        "publish_steps": json.dumps(_sanitize(publish_steps)),
        "deployed_versions": json.dumps(_sanitize(deployed_versions)),
        "source_url": repo_url if repo_url.startswith("http") else None,
    }), on_conflict="id")

    # ── Step 3: Register agent for red-teaming ────────────────────────────────
    agent_id = str(uuid.uuid4())
    session_id = str(uuid.uuid4())
    redteam_status = "skipped"

    mcp_tools = [t.strip() for t in (mcp_tools_csv or "").split(",") if t.strip()]
    countries = [c.strip() for c in deployment_countries_csv.split(",") if c.strip()] or ["us"]
    modalities = [m.strip() for m in modalities_csv.split(",") if m.strip()] or ["text"]
    tm_status = "threat_model_ready" if has_own_threat_model else "awaiting_threat_model"

    effective_name = agent_display_name or registry_safe_name or "AI Agent"

    try:
        agent_record = AgentEntity(
            id=agent_id, user_id=user_id,
            name=effective_name, target_url=endpoint_url,
            agent_type=agent_type, media_types=modalities,
            description=tasks_description, domain=domain,
            has_pii="yes" if processes_pii else "no",
            countries=countries,
            architecture_diagram={"type": arch_type, "code": arch_code},
            dataflow_diagram={"type": dataflow_type, "code": dataflow_code},
            has_mcp=has_mcp, mcp_tools=mcp_tools,
            sensitivity=sensitivity, is_public_facing=is_public_facing,
            handles_financial=handles_financial, handles_medical=handles_medical,
            schedule_interval_minutes=schedule_interval_minutes,
            is_active=True, sync_source="unified",
        )

        registered_agent = RegisteredAgentEntity(
            id=agent_id, user_id=user_id,
            name=effective_name, target_url=endpoint_url,
            agent_type=agent_type, domain=domain, sensitivity=sensitivity,
            modalities=modalities, deployment_countries=countries,
            processes_pii=processes_pii, handles_financial=handles_financial,
            handles_medical=handles_medical, has_mcp=has_mcp, mcp_tools=mcp_tools,
            tasks_description=tasks_description,
            schedule_interval_minutes=schedule_interval_minutes,
            is_active=True,
            last_registry_version=registry_agent_version,
            sync_source="unified",
        )

        session_record = SessionEntity(
            id=session_id, agent_id=agent_id, user_id=user_id,
            status=tm_status, has_own_tm=has_own_threat_model,
            trigger_type="manual",
        )

        db.add(agent_record)
        db.add(registered_agent)
        db.add(session_record)
        db.commit()
        redteam_status = "registered"

        # ── Step 4: Write version event ───────────────────────────────────────
        if registry_agent_version:
            version_event = AgentVersionEventEntity(
                id=str(uuid.uuid4()),
                agent_name=effective_name,
                registry_agent_name=registry_safe_name,
                new_version=registry_agent_version,
                endpoint_url=endpoint_url,
                triggered_session_id=session_id,
                status="triggered",
            )
            db.add(version_event)
            db.commit()

        # ── Step 5: Handle threat model upload ────────────────────────────────
        if has_own_threat_model and threat_model_file and threat_model_file.filename:
            from src.api.v1.threat_models import _process_threat_model_upload
            try:
                await _process_threat_model_upload(session_id, threat_model_file, db)
            except Exception as e:
                print(f"[UnifiedRegister] Threat model upload error: {e}")

        # ── Step 6: Temporal Schedule + immediate workflow ────────────────────
        schedule_payload = {
            "endpoint_url": endpoint_url, "agent_type": agent_type,
            "domain": domain, "sensitivity": sensitivity,
            "processes_pii": processes_pii, "handles_financial": handles_financial,
            "handles_medical": handles_medical, "has_mcp": has_mcp,
            "modalities": modalities, "deployment_countries": countries,
            "tasks_description": tasks_description,
        }

        async def _launch_temporal():
            try:
                from src.services.temporal_scheduler import create_agent_schedule
                await create_agent_schedule(agent_id, schedule_interval_minutes, schedule_payload)
            except Exception as e:
                print(f"[UnifiedRegister] Temporal schedule error: {e}")

            try:
                from src.workers.temporal_worker import launch_redteam_workflow
                payload = {"session_id": session_id, "agent_id": agent_id, **schedule_payload}
                await launch_redteam_workflow(payload)
            except Exception as e:
                print(f"[UnifiedRegister] Workflow launch error: {e}")

        background_tasks.add_task(_launch_temporal)
        redteam_status = "launched"

    except Exception as ex:
        db.rollback()
        print(f"[UnifiedRegister] DB/redteam error: {ex}")
        redteam_status = f"error: {ex}"

    return JSONResponse(content=_sanitize({
        "session_id": session_id,
        "agent_id": agent_id,
        "registry_status": registry_status,
        "redteam_status": redteam_status,
        "pass_rate_pct": pass_rate_pct,
        "message": (
            f"Agent '{effective_name}' registered and published. "
            f"Registry: {registry_status}. Red-team: {redteam_status}."
        ),
        "publish_steps": _sanitize(publish_steps),
        "deployed_versions": _sanitize(deployed_versions),
        "registry_version": registry_agent_version,
        "file_errors": file_errors,
        "stats": _sanitize(stats),
    }))
