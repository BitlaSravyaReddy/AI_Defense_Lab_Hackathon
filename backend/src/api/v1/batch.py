"""
batch.py — Batch Red Teaming & Multi-Session Streaming API
Triggers parallel attacks via Temporal BatchRedTeamWorkflow (child workflows)
and streams multi-session progress via SSE.
"""
import uuid
import asyncio
import json
from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Request
from fastapi.responses import StreamingResponse
from pydantic import BaseModel
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import RegisteredAgentEntity, SessionEntity, RedTeamProgressEntity
from src.api.v1.auth import get_current_user_optional

router = APIRouter(prefix="/redteam", tags=["Batch Red Teaming"])


class BatchRunRequest(BaseModel):
    agent_ids: Optional[List[str]] = None  # None = run for all registered active agents


class BatchRunResponse(BaseModel):
    batch_id: str
    session_ids: List[str]
    agents_count: int
    message: str


@router.post("/batch-run", response_model=BatchRunResponse)
async def trigger_batch_run(
    req: BatchRunRequest,
    db: Session = Depends(get_db),
    current_user=Depends(get_current_user_optional),
):
    """Triggers parallel red-team sessions across all (or selected) registered agents
    using Temporal BatchRedTeamWorkflow with child workflows."""
    query = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.is_active == True)
    if current_user:
        query = query.filter(RegisteredAgentEntity.user_id == current_user.id)
    if req.agent_ids and len(req.agent_ids) > 0:
        query = query.filter(RegisteredAgentEntity.id.in_(req.agent_ids))

    agents = query.all()
    if not agents:
        raise HTTPException(404, "No active registered agents found to run batch evaluation")

    batch_id = str(uuid.uuid4())
    user_id = current_user.id if current_user else None
    session_ids = []
    agent_inputs = []

    for agent in agents:
        session_id = str(uuid.uuid4())
        session_ids.append(session_id)

        session_record = SessionEntity(
            id=session_id,
            agent_id=agent.id,
            user_id=user_id,
            batch_id=batch_id,
            trigger_type="batch",
            status="running",
            has_own_tm=False,
        )
        db.add(session_record)

        agent_inputs.append({
            "session_id": session_id,
            "agent_id": agent.id,
            "endpoint_url": agent.target_url,
            "agent_type": agent.agent_type,
            "domain": agent.domain,
            "sensitivity": agent.sensitivity,
            "processes_pii": agent.processes_pii,
            "handles_financial": agent.handles_financial,
            "handles_medical": agent.handles_medical,
            "has_mcp": agent.has_mcp,
            "modalities": agent.modalities or ["text"],
            "deployment_countries": agent.deployment_countries or ["us"],
            "tasks_description": agent.tasks_description or "",
        })

    db.commit()

    # Try Temporal BatchRedTeamWorkflow, fallback to background tasks
    try:
        from temporalio.client import Client
        from src.workers.workflow import BatchRedTeamWorkflow, BatchRedTeamInput
        import os

        TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
        client = await Client.connect(TEMPORAL_HOST)

        batch_inp = BatchRedTeamInput(
            batch_id=batch_id,
            agent_inputs=agent_inputs,
        )

        workflow_id = f"batch-redteam-{batch_id}"
        await client.start_workflow(
            BatchRedTeamWorkflow.run,
            batch_inp,
            id=workflow_id,
            task_queue="redteam-task-queue",
        )
        print(f"[Batch] Started BatchRedTeamWorkflow '{workflow_id}' with {len(agents)} agents")

    except Exception as e:
        print(f"[Batch] Temporal BatchRedTeamWorkflow failed ({e}), falling back to background tasks...")
        from src.workers.temporal_worker import launch_redteam_workflow
        for inp in agent_inputs:
            asyncio.create_task(launch_redteam_workflow(inp))

    return BatchRunResponse(
        batch_id=batch_id,
        session_ids=session_ids,
        agents_count=len(agents),
        message=f"Batch attack launched for {len(agents)} agents under batch_id '{batch_id}'.",
    )


@router.get("/batch-stream/{batch_id}")
async def stream_batch_progress(batch_id: str, request: Request, db: Session = Depends(get_db)):
    """Streams live multi-session progress for all sessions in a batch run.

    Emits:
      event: batch_stage — periodic update with structured per-agent progress array
      event: batch_complete — final event when all sessions have reached a terminal state
    """
    sessions = db.query(SessionEntity).filter(SessionEntity.batch_id == batch_id).all()
    if not sessions:
        raise HTTPException(404, "Batch ID not found")

    session_ids = [s.id for s in sessions]
    total_sessions = len(session_ids)

    # Pre-build agent info maps
    agent_ids = list({s.agent_id for s in sessions})
    agents_db = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.id.in_(agent_ids)).all()
    agent_name_map = {a.id: a.name for a in agents_db}
    # Map session_id -> agent_id
    session_agent_map = {s.id: s.agent_id for s in sessions}

    TERMINAL_STATUSES = {"complete", "error", "failed", "terminated", "canceled"}

    async def event_generator():
        max_polls = 2400  # 20 min max at 0.5s interval
        for _ in range(max_polls):
            if await request.is_disconnected():
                break

            # Re-query sessions for fresh status
            fresh_sessions = (
                db.query(SessionEntity)
                .filter(SessionEntity.batch_id == batch_id)
                .all()
            )
            session_status_map = {s.id: s.status for s in fresh_sessions}
            session_score_map = {s.id: (s.confidence_score, s.confidence_tier) for s in fresh_sessions}

            # Get the latest stage progress for each session
            progresses = (
                db.query(RedTeamProgressEntity)
                .filter(RedTeamProgressEntity.session_id.in_(session_ids))
                .order_by(RedTeamProgressEntity.updated_at.desc())
                .all()
            )

            # Build a latest-stage-per-session dict
            latest_per_session: dict[str, RedTeamProgressEntity] = {}
            for p in progresses:
                if p.session_id not in latest_per_session:
                    latest_per_session[p.session_id] = p

            # Count terminal sessions
            completed_count = sum(
                1 for sid in session_ids if session_status_map.get(sid) == "complete"
            )
            failed_count = sum(
                1 for sid in session_ids
                if session_status_map.get(sid) in ("error", "failed", "terminated", "canceled")
            )
            running_count = total_sessions - completed_count - failed_count

            # Build per-agent structured array
            agents_payload = []
            for sid in session_ids:
                agent_id = session_agent_map.get(sid, "")
                status = session_status_map.get(sid, "pending")
                score, tier = session_score_map.get(sid, (None, None))
                prog = latest_per_session.get(sid)

                agents_payload.append({
                    "session_id": sid,
                    "agent_id": agent_id,
                    "agent_name": agent_name_map.get(agent_id, "Agent"),
                    "status": status,
                    "current_stage": prog.stage_id if prog else "pending",
                    "current_stage_name": prog.stage_name if prog else "Queued",
                    "progress": prog.progress if prog else 0,
                    "message": prog.message if prog else "",
                    "confidence_score": score,
                    "confidence_tier": tier,
                })

            all_terminal = all(
                session_status_map.get(sid, "pending") in TERMINAL_STATUSES
                for sid in session_ids
            )

            batch_payload = {
                "batch_id": batch_id,
                "total_sessions": total_sessions,
                "completed_sessions": completed_count,
                "failed_sessions": failed_count,
                "running_sessions": running_count,
                "all_done": all_terminal,
                "agents": agents_payload,
            }

            yield f"event: batch_stage\ndata: {json.dumps(batch_payload)}\n\n"

            if all_terminal:
                yield f"event: batch_complete\ndata: {json.dumps(batch_payload)}\n\n"
                break

            await asyncio.sleep(0.5)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={"Cache-Control": "no-cache", "X-Accel-Buffering": "no", "Connection": "keep-alive"},
    )


@router.post("/{batch_id}/terminate")
async def terminate_batch_run(batch_id: str, db: Session = Depends(get_db)):
    """Terminates all running sessions in a batch attack run."""
    sessions = db.query(SessionEntity).filter(SessionEntity.batch_id == batch_id).all()
    if not sessions:
        raise HTTPException(404, "Batch ID not found")

    terminated_count = 0
    from temporalio.client import Client
    import os
    TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")

    try:
        client = await Client.connect(TEMPORAL_HOST)
        # Terminate parent batch workflow if running
        try:
            batch_handle = client.get_workflow_handle(f"redteam-batch-{batch_id}")
            await batch_handle.terminate(reason="Batch terminated by user from UI")
        except Exception:
            pass

        # Terminate individual child session workflows
        for s in sessions:
            if s.status in ("running", "pending"):
                try:
                    h = client.get_workflow_handle(s.temporal_workflow_id or f"redteam-{s.id}")
                    await h.terminate(reason="Batch terminated by user from UI")
                except Exception:
                    pass
                s.status = "terminated"
                terminated_count += 1

        db.commit()
    except Exception as e:
        print(f"[Batch Terminate] Note: {e}")

    return {
        "status": "success",
        "batch_id": batch_id,
        "terminated_count": terminated_count,
        "message": f"Terminated {terminated_count} running sessions in batch {batch_id}.",
    }

