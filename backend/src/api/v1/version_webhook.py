"""
version_webhook.py — Auto-retest on agent redeploy.

POST /api/v1/agents/version-event
Called internally after publish_all() success (or from external CI/CD pipelines).
Detects new agent version, looks up the existing RegisteredAgentEntity,
and auto-launches a new RedTeamWorkflow for the updated agent.
"""
import uuid
import datetime
from typing import Optional

from fastapi import APIRouter, Depends, BackgroundTasks
from pydantic import BaseModel
from sqlalchemy.orm import Session

from src.db.session import get_db
from src.db.models import (
    RegisteredAgentEntity, SessionEntity, AgentVersionEventEntity
)

router = APIRouter(prefix="/agents", tags=["Version Events"])


class VersionEventRequest(BaseModel):
    agent_name: str
    new_version: str
    endpoint_url: Optional[str] = None  # override target URL if agent redeployed to new URL


class VersionEventResponse(BaseModel):
    status: str                    # "triggered" | "skipped" | "not_found" | "error"
    agent_id: Optional[str] = None
    session_id: Optional[str] = None
    agent_name: str
    new_version: str
    message: str


@router.post("/version-event", response_model=VersionEventResponse)
async def handle_version_event(
    req: VersionEventRequest,
    background_tasks: BackgroundTasks,
    db: Session = Depends(get_db),
):
    """
    Called when a new agent version is published to the registry.
    If the agent is registered in the red-team fleet, automatically
    triggers a new evaluation session (trigger_type='version_update').
    """
    # Find the registered agent by name
    ra = db.query(RegisteredAgentEntity).filter(
        RegisteredAgentEntity.name == req.agent_name
    ).first()

    # Also try matching by registry_safe_name stored in the version events
    if not ra:
        # Try a case-insensitive partial match
        ra = db.query(RegisteredAgentEntity).filter(
            RegisteredAgentEntity.name.ilike(f"%{req.agent_name}%")
        ).first()

    if not ra:
        # Record the event but mark as skipped (no registered agent)
        event = AgentVersionEventEntity(
            id=str(uuid.uuid4()),
            agent_name=req.agent_name,
            new_version=req.new_version,
            endpoint_url=req.endpoint_url,
            status="skipped",
            error_message="No registered agent found with this name.",
        )
        db.add(event)
        db.commit()
        return VersionEventResponse(
            status="not_found",
            agent_name=req.agent_name,
            new_version=req.new_version,
            message=f"No registered agent found matching '{req.agent_name}'. Version event recorded but no evaluation triggered.",
        )

    # Check if this version was already evaluated
    existing_event = db.query(AgentVersionEventEntity).filter(
        AgentVersionEventEntity.agent_name == req.agent_name,
        AgentVersionEventEntity.new_version == req.new_version,
        AgentVersionEventEntity.status == "triggered",
    ).first()

    if existing_event:
        return VersionEventResponse(
            status="skipped",
            agent_id=ra.id,
            session_id=existing_event.triggered_session_id,
            agent_name=req.agent_name,
            new_version=req.new_version,
            message=f"Version {req.new_version} was already evaluated (session: {existing_event.triggered_session_id}).",
        )

    # Update endpoint URL if provided (agent redeployed to new URL)
    if req.endpoint_url and req.endpoint_url != ra.target_url:
        ra.target_url = req.endpoint_url

    # Update the last_registry_version
    ra.last_registry_version = req.new_version
    ra.last_evaluated_at = datetime.datetime.utcnow()

    # Create new evaluation session
    session_id = str(uuid.uuid4())
    session_record = SessionEntity(
        id=session_id,
        agent_id=ra.id,
        user_id=ra.user_id,
        status="pending",
        trigger_type="version_update",
        has_own_tm=False,
    )
    db.add(session_record)

    # Record the version event
    event = AgentVersionEventEntity(
        id=str(uuid.uuid4()),
        agent_name=req.agent_name,
        registry_agent_name=req.agent_name,
        new_version=req.new_version,
        previous_version=ra.last_registry_version,
        endpoint_url=req.endpoint_url or ra.target_url,
        triggered_session_id=session_id,
        status="triggered",
    )
    db.add(event)
    db.commit()

    # Build workflow payload
    workflow_payload = {
        "session_id": session_id,
        "agent_id": ra.id,
        "endpoint_url": req.endpoint_url or ra.target_url,
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

    async def _trigger():
        try:
            from src.workers.temporal_worker import launch_redteam_workflow
            await launch_redteam_workflow(workflow_payload)
            print(f"[VersionWebhook] Launched re-evaluation for '{req.agent_name}' v{req.new_version} → session {session_id}")
        except Exception as e:
            print(f"[VersionWebhook] Workflow launch error: {e}")
            # Update session status to failed if workflow launch fails
            from src.db.session import SessionLocal
            _db = SessionLocal()
            try:
                s = _db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
                if s:
                    s.status = "failed"
                    _db.commit()
            finally:
                _db.close()

    background_tasks.add_task(_trigger)

    return VersionEventResponse(
        status="triggered",
        agent_id=ra.id,
        session_id=session_id,
        agent_name=req.agent_name,
        new_version=req.new_version,
        message=(
            f"New version '{req.new_version}' detected for agent '{ra.name}'. "
            f"Automatic red-team evaluation launched (session: {session_id})."
        ),
    )


@router.get("/version-events")
async def list_version_events(
    agent_name: Optional[str] = None,
    db: Session = Depends(get_db),
):
    """List all version events, optionally filtered by agent name."""
    q = db.query(AgentVersionEventEntity)
    if agent_name:
        q = q.filter(AgentVersionEventEntity.agent_name.ilike(f"%{agent_name}%"))
    events = q.order_by(AgentVersionEventEntity.created_at.desc()).all()
    return [
        {
            "id": e.id,
            "agent_name": e.agent_name,
            "new_version": e.new_version,
            "previous_version": e.previous_version,
            "endpoint_url": e.endpoint_url,
            "triggered_session_id": e.triggered_session_id,
            "status": e.status,
            "error_message": e.error_message,
            "created_at": e.created_at.isoformat() if e.created_at else None,
        }
        for e in events
    ]
