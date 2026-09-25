"""
registered_agents.py — Registered Agent Fleet API
Lists, syncs, schedules, and triggers evaluations for persistent registered agents.
User-scoped: endpoints filter by JWT user_id when available.
"""
import uuid
import datetime
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import RegisteredAgentEntity, AgentEntity, SessionEntity, RedTeamProgressEntity
from src.api.v1.auth import get_current_user_optional

router = APIRouter(prefix="/registered-agents", tags=["Registered Agents"])


class UpdateScheduleRequest(BaseModel):
    interval_minutes: int  # e.g. 20, 60, 120, 1440
    is_active: Optional[bool] = True


class RegisteredAgentDTO(BaseModel):
    id: str
    name: str
    target_url: str
    agent_type: str
    domain: str
    sensitivity: str
    modalities: List[str]
    deployment_countries: List[str]
    processes_pii: bool
    handles_financial: bool
    handles_medical: bool
    has_mcp: bool
    mcp_tools: List[str]
    tasks_description: Optional[str]
    schedule_interval_minutes: int
    is_active: bool
    last_evaluated_at: Optional[datetime.datetime]
    sync_source: str
    created_at: datetime.datetime
    latest_score: Optional[float] = None
    latest_tier: Optional[str] = None
    latest_session_id: Optional[str] = None
    total_sessions_count: int = 0


@router.get("", response_model=List[RegisteredAgentDTO])
async def list_registered_agents(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """Returns all registered agents along with their latest session metrics.
    Scoped by user_id when JWT is provided."""
    query = db.query(RegisteredAgentEntity)
    if current_user:
        query = query.filter(RegisteredAgentEntity.user_id == current_user.id)

    reg_agents = query.all()
    results = []

    for ra in reg_agents:
        # Find latest session for this agent
        sessions = db.query(SessionEntity).filter(
            SessionEntity.agent_id == ra.id
        ).order_by(SessionEntity.created_at.desc()).all()

        latest_sess = sessions[0] if sessions else None

        results.append(RegisteredAgentDTO(
            id=ra.id,
            name=ra.name,
            target_url=ra.target_url,
            agent_type=ra.agent_type,
            domain=ra.domain,
            sensitivity=ra.sensitivity,
            modalities=ra.modalities or ["text"],
            deployment_countries=ra.deployment_countries or ["us"],
            processes_pii=ra.processes_pii,
            handles_financial=ra.handles_financial,
            handles_medical=ra.handles_medical,
            has_mcp=ra.has_mcp,
            mcp_tools=ra.mcp_tools or [],
            tasks_description=ra.tasks_description,
            schedule_interval_minutes=ra.schedule_interval_minutes,
            is_active=ra.is_active,
            last_evaluated_at=ra.last_evaluated_at,
            sync_source=ra.sync_source,
            created_at=ra.created_at,
            latest_score=latest_sess.confidence_score if latest_sess else None,
            latest_tier=latest_sess.confidence_tier if latest_sess else None,
            latest_session_id=latest_sess.id if latest_sess else None,
            total_sessions_count=len(sessions),
        ))

    return results


@router.post("/sync")
async def sync_registry(
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """Syncs agents from registered_agents table to active redteam_agents.
    Creates Temporal Schedules for newly synced agents."""
    registered = db.query(RegisteredAgentEntity).all()
    synced_count = 0
    scheduled_count = 0

    for ra in registered:
        existing = db.query(AgentEntity).filter(AgentEntity.id == ra.id).first()
        if not existing:
            agent_record = AgentEntity(
                id=ra.id,
                user_id=ra.user_id,
                name=ra.name,
                target_url=ra.target_url,
                agent_type=ra.agent_type,
                media_types=ra.modalities or ["text"],
                description=ra.tasks_description,
                domain=ra.domain,
                has_pii="yes" if ra.processes_pii else "no",
                countries=ra.deployment_countries or ["us"],
                has_mcp=ra.has_mcp,
                mcp_tools=ra.mcp_tools or [],
                sensitivity=ra.sensitivity,
                is_public_facing=True,
                handles_financial=ra.handles_financial,
                handles_medical=ra.handles_medical,
                schedule_interval_minutes=ra.schedule_interval_minutes,
                is_active=ra.is_active,
                sync_source=ra.sync_source,
            )
            db.add(agent_record)
            synced_count += 1

            # Create Temporal Schedule for this agent
            if ra.is_active:
                try:
                    from src.services.temporal_scheduler import create_agent_schedule
                    import asyncio
                    schedule_payload = {
                        "endpoint_url": ra.target_url,
                        "agent_type": ra.agent_type,
                        "domain": ra.domain,
                        "sensitivity": ra.sensitivity,
                        "processes_pii": ra.processes_pii,
                        "handles_financial": ra.handles_financial,
                        "handles_medical": ra.handles_medical,
                        "has_mcp": ra.has_mcp,
                        "modalities": ra.modalities or ["text"],
                        "deployment_countries": ra.deployment_countries or ["us"],
                        "tasks_description": ra.tasks_description or "",
                    }
                    asyncio.create_task(
                        create_agent_schedule(ra.id, ra.schedule_interval_minutes, schedule_payload)
                    )
                    scheduled_count += 1
                except Exception as e:
                    print(f"[Sync] Schedule creation deferred for {ra.id}: {e}")

    db.commit()
    return {
        "status": "success",
        "synced_agents_count": synced_count,
        "schedules_created": scheduled_count,
    }


@router.post("/{agent_id}/schedule")
async def update_schedule(
    agent_id: str,
    req: UpdateScheduleRequest,
    db: Session = Depends(get_db)
):
    """Updates periodic schedule interval for a registered agent.
    Also updates the Temporal Schedule."""
    ra = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.id == agent_id).first()
    if not ra:
        raise HTTPException(404, "Registered agent not found")

    ra.schedule_interval_minutes = req.interval_minutes
    if req.is_active is not None:
        ra.is_active = req.is_active

    agent_record = db.query(AgentEntity).filter(AgentEntity.id == agent_id).first()
    if agent_record:
        agent_record.schedule_interval_minutes = req.interval_minutes
        if req.is_active is not None:
            agent_record.is_active = req.is_active

    db.commit()

    # Update Temporal Schedule
    try:
        from src.services.temporal_scheduler import update_agent_schedule, pause_agent_schedule, resume_agent_schedule
        import asyncio
        if req.is_active:
            asyncio.create_task(update_agent_schedule(agent_id, req.interval_minutes))
            asyncio.create_task(resume_agent_schedule(agent_id))
        else:
            asyncio.create_task(pause_agent_schedule(agent_id))
    except Exception as e:
        print(f"[Schedule Update] Temporal schedule update deferred: {e}")

    return {
        "status": "success",
        "agent_id": agent_id,
        "schedule_interval_minutes": req.interval_minutes,
        "is_active": ra.is_active,
    }


@router.post("/{agent_id}/trigger")
async def trigger_agent_evaluation(
    agent_id: str,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """Triggers an evaluation run for an existing registered agent without re-registering."""
    ra = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.id == agent_id).first()
    if not ra:
        raise HTTPException(404, "Registered agent not found")

    user_id = current_user.id if current_user else ra.user_id
    session_id = str(uuid.uuid4())
    session_record = SessionEntity(
        id=session_id,
        agent_id=agent_id,
        user_id=user_id,
        status="running",
        trigger_type="manual",
        has_own_tm=False,
    )
    db.add(session_record)
    ra.last_evaluated_at = datetime.datetime.utcnow()
    db.commit()

    # Launch Temporal workflow asynchronously
    from src.workers.temporal_worker import launch_redteam_workflow
    payload = {
        "session_id": session_id,
        "agent_id": agent_id,
        "endpoint_url": ra.target_url,
        "agent_type": ra.agent_type,
        "domain": ra.domain,
        "sensitivity": ra.sensitivity,
        "processes_pii": ra.processes_pii,
        "handles_financial": ra.handles_financial,
        "handles_medical": ra.handles_medical,
        "has_mcp": ra.has_mcp,
        "modalities": ra.modalities or ["text"],
        "deployment_countries": ra.deployment_countries or ["us"],
        "tasks_description": ra.tasks_description or "",
    }
    background_tasks.add_task(launch_redteam_workflow, payload)

    return {
        "session_id": session_id,
        "agent_id": agent_id,
        "status": "running",
        "message": f"Evaluation launched for agent {ra.name}",
    }


@router.get("/{agent_id}/sessions")
async def get_agent_session_history(agent_id: str, db: Session = Depends(get_db)):
    """Returns all historical red-teaming sessions for a specific agent."""
    ra = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.id == agent_id).first()
    if not ra:
        raise HTTPException(404, "Registered agent not found")

    sessions = db.query(SessionEntity).filter(
        SessionEntity.agent_id == agent_id
    ).order_by(SessionEntity.created_at.desc()).all()

    # Sync any active/running sessions with Temporal workflow status
    for s in sessions:
        if s.status in ("running", "pending"):
            try:
                from temporalio.client import Client
                import os
                TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
                client = await Client.connect(TEMPORAL_HOST)
                workflow_id = s.temporal_workflow_id or f"redteam-{s.id}"
                handle = client.get_workflow_handle(workflow_id)
                desc = await handle.describe()
                st = str(desc.status).lower()
                if "terminated" in st:
                    s.status = "terminated"
                    db.commit()
                elif "failed" in st:
                    s.status = "failed"
                    db.commit()
                elif "canceled" in st or "cancelled" in st:
                    s.status = "canceled"
                    db.commit()
                elif "completed" in st:
                    s.status = "complete"
                    db.commit()
            except Exception:
                pass

    return {
        "agent": {
            "id": ra.id,
            "name": ra.name,
            "target_url": ra.target_url,
            "agent_type": ra.agent_type,
            "domain": ra.domain,
            "sensitivity": ra.sensitivity,
        },
        "total_sessions": len(sessions),
        "sessions": [
            {
                "session_id": s.id,
                "status": s.status,
                "trigger_type": s.trigger_type,
                "batch_id": s.batch_id,
                "confidence_score": s.confidence_score,
                "confidence_tier": s.confidence_tier,
                "evaluation_summary": s.evaluation_summary,
                "created_at": s.created_at,
            }
            for s in sessions
        ],
    }


class CompareSessionsRequest(BaseModel):
    session_ids: List[str]


@router.post("/compare-sessions")
async def compare_agent_sessions(req: CompareSessionsRequest, db: Session = Depends(get_db)):
    """Compare security posture and attack results across multiple sessions."""
    if len(req.session_ids) < 2:
        raise HTTPException(400, "Please select at least 2 sessions to compare.")

    from src.services.results_aggregator import build_full_results
    sessions_data = []

    for sid in req.session_ids:
        sess = db.query(SessionEntity).filter(SessionEntity.id == sid).first()
        if not sess:
            continue

        res = build_full_results(sid)
        sessions_data.append({
            "session_id": sid,
            "agent_id": sess.agent_id,
            "status": sess.status,
            "trigger_type": sess.trigger_type,
            "created_at": sess.created_at.isoformat() if sess.created_at else None,
            "confidence_score": res["confidence"],
            "confidence_tier": res["confidence_tier"],
            "total_transcripts": res["total_transcripts"],
            "passed_transcripts": sum(1 for t in res["transcripts"] if t["passed"]),
            "failed_transcripts": sum(1 for t in res["transcripts"] if not t["passed"]),
            "categories": res["categories"],
            "country_verdicts": res["country_verdicts"],
            "attacks": [
                {
                    "id": a["id"],
                    "name": a["name"],
                    "vulnerability": a["vulnerability"],
                    "passed": a["passed"],
                    "score": a["score"],
                }
                for a in res["attacks"]
            ]
        })

    return {
        "status": "success",
        "compared_count": len(sessions_data),
        "sessions": sessions_data,
    }
