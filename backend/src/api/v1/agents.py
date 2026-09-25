"""
agents.py — Agent Registration API
Registers an agent, creates RegisteredAgent + AgentEntity dual records,
creates a Temporal Schedule for periodic evaluation, and triggers workflow.
"""
import uuid
import time
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import AgentEntity, SessionEntity, RegisteredAgentEntity
from src.schemas.agent import AgentRegisterRequest, AgentRegisterResponse
from src.api.v1.auth import get_current_user_optional

router = APIRouter(prefix="/agents", tags=["Agent Registration"])

# In-memory session cache for fast status checks
_sessions_cache: dict[str, dict] = {}


def get_sessions_cache() -> dict:
    return _sessions_cache


@router.post("/register", response_model=AgentRegisterResponse)
async def register_agent(
    profile: AgentRegisterRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """Registers target agent, creates RegisteredAgent + AgentEntity,
    creates a Temporal Schedule, and saves to Supabase."""
    session_id = str(uuid.uuid4())
    agent_id = str(uuid.uuid4())
    user_id = current_user.id if current_user else None
    status = "threat_model_ready" if profile.has_own_threat_model else "awaiting_threat_model"

    try:
        # 1. Create AgentEntity (used by redteam pipeline)
        agent_record = AgentEntity(
            id=agent_id,
            user_id=user_id,
            name=profile.name,
            target_url=profile.endpoint_url,
            agent_type=profile.agent_type,
            media_types=profile.modalities or ["text"],
            description=profile.tasks_description,
            domain=profile.domain,
            has_pii="yes" if profile.processes_pii else "no",
            countries=profile.deployment_countries or [],
            sample_pairs=profile.sample_inputs or [],
            architecture_diagram={"type": profile.arch_type, "code": profile.arch_code},
            dataflow_diagram={"type": profile.dataflow_type, "code": profile.dataflow_code},
            has_mcp=profile.has_mcp,
            mcp_tools=profile.mcp_tools or [],
            sensitivity=profile.sensitivity,
            is_public_facing=profile.is_public_facing,
            handles_financial=profile.handles_financial,
            handles_medical=profile.handles_medical,
            schedule_interval_minutes=profile.schedule_interval_minutes,
            is_active=True,
            sync_source="manual",
        )

        # 2. Create RegisteredAgentEntity (fleet dashboard record)
        registered_agent = RegisteredAgentEntity(
            id=agent_id,
            user_id=user_id,
            name=profile.name,
            target_url=profile.endpoint_url,
            agent_type=profile.agent_type,
            domain=profile.domain,
            sensitivity=profile.sensitivity,
            modalities=profile.modalities or ["text"],
            deployment_countries=profile.deployment_countries or [],
            processes_pii=profile.processes_pii,
            handles_financial=profile.handles_financial,
            handles_medical=profile.handles_medical,
            has_mcp=profile.has_mcp,
            mcp_tools=profile.mcp_tools or [],
            tasks_description=profile.tasks_description,
            schedule_interval_minutes=profile.schedule_interval_minutes,
            is_active=True,
            sync_source="manual",
        )

        # 3. Create session
        session_record = SessionEntity(
            id=session_id,
            agent_id=agent_id,
            user_id=user_id,
            status=status,
            has_own_tm=profile.has_own_threat_model,
        )

        db.add(agent_record)
        db.add(registered_agent)
        db.add(session_record)
        db.commit()

        # 4. Create Temporal Schedule for periodic evaluation
        try:
            from src.services.temporal_scheduler import create_agent_schedule
            schedule_payload = {
                "endpoint_url": profile.endpoint_url,
                "agent_type": profile.agent_type,
                "domain": profile.domain,
                "sensitivity": profile.sensitivity,
                "processes_pii": profile.processes_pii,
                "handles_financial": profile.handles_financial,
                "handles_medical": profile.handles_medical,
                "has_mcp": profile.has_mcp,
                "modalities": profile.modalities or ["text"],
                "deployment_countries": profile.deployment_countries or [],
                "tasks_description": profile.tasks_description,
            }
            interval = profile.schedule_interval_minutes if (profile.schedule_interval_minutes and profile.schedule_interval_minutes > 0) else 60
            import asyncio
            asyncio.create_task(
                create_agent_schedule(agent_id, interval, schedule_payload)
            )
            print(f"[Agent Register] Temporal Schedule task dispatched for agent '{agent_id}' ({profile.name}) — interval {interval}m")
        except Exception as e:
            print(f"[Agent Register] Temporal Schedule creation error: {e}")

    except Exception as e:
        print(f"[Agent Register DB Error]: {e}")
        db.rollback()

    _sessions_cache[session_id] = {
        "profile": profile.model_dump(),
        "status": status,
        "agent_id": agent_id,
        "created_at": time.time(),
    }

    return AgentRegisterResponse(
        session_id=session_id,
        agent_id=agent_id,
        status=status,
        message=f"Agent '{profile.name}' registered. Periodic evaluation every {profile.schedule_interval_minutes}m. Upload threat model to start evaluation.",
    )


@router.get("/session/{session_id}/status")
async def get_session_status(session_id: str, db: Session = Depends(get_db)):
    sess = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
    if not sess:
        raise HTTPException(404, "Session not found")

    if sess.status in ("running", "pending"):
        try:
            from temporalio.client import Client
            import os
            TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
            client = await Client.connect(TEMPORAL_HOST)
            workflow_id = sess.temporal_workflow_id or f"redteam-{sess.id}"
            handle = client.get_workflow_handle(workflow_id)
            desc = await handle.describe()
            st = str(desc.status).lower()
            if "terminated" in st:
                sess.status = "terminated"
                db.commit()
            elif "failed" in st:
                sess.status = "failed"
                db.commit()
            elif "canceled" in st or "cancelled" in st:
                sess.status = "canceled"
                db.commit()
            elif "completed" in st:
                sess.status = "complete"
                db.commit()
        except Exception:
            pass

    return {
        "session_id": session_id,
        "status": sess.status,
        "confidence_score": sess.confidence_score,
        "confidence_tier": sess.confidence_tier,
    }


@router.post("/session/{session_id}/terminate")
async def terminate_session(session_id: str, db: Session = Depends(get_db)):
    """Terminates a running red-teaming evaluation session workflow immediately."""
    sess = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
    if not sess:
        raise HTTPException(404, "Session not found")

    workflow_id = sess.temporal_workflow_id or f"redteam-{session_id}"
    terminated_ok = False

    try:
        from temporalio.client import Client
        import os
        TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
        client = await Client.connect(TEMPORAL_HOST)
        handle = client.get_workflow_handle(workflow_id)
        await handle.terminate(reason="Terminated by user from UI dashboard")
        terminated_ok = True
    except Exception as e:
        print(f"[Terminate Session] Note for {workflow_id}: {e}")

    sess.status = "terminated"
    db.commit()

    # Log progress record
    import uuid
    db.add(RedTeamProgressEntity(
        id=str(uuid.uuid4()),
        session_id=session_id,
        stage_id="complete",
        stage_name="Terminated",
        stage_index=4,
        progress=100,
        message="Evaluation pipeline terminated by user.",
        done=True,
    ))
    db.commit()

    return {
        "status": "success",
        "session_id": session_id,
        "workflow_id": workflow_id,
        "message": "Evaluation attack pipeline terminated successfully.",
    }
