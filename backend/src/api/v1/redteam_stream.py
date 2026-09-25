"""
redteam_stream.py — SSE Stream & Results endpoints

GET /redteam/stream/{session_id}
  - Triggers the Temporal RedTeamWorkflow via Temporal client
  - Polls Supabase redteam_progress table and streams SSE events to client

GET /redteam/results/{session_id}
  - Returns full aggregated results JSON from Supabase
"""
import asyncio
import json
import os
from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse, JSONResponse

from src.services.results_aggregator import build_full_results

router = APIRouter(prefix="/redteam", tags=["Red Team Stream"])

TEMPORAL_HOST = os.getenv("TEMPORAL_HOST", "localhost:7233")
TASK_QUEUE = "redteam-task-queue"


def _sse(event: str, data: dict) -> str:
    return f"event: {event}\ndata: {json.dumps(data)}\n\n"


async def _trigger_temporal_workflow(session_id: str):
    """Start the Temporal RedTeamWorkflow for this session."""
    try:
        from temporalio.client import Client
        from src.workers.workflow import RedTeamWorkflow, RedTeamInput
        from src.db.session import SessionLocal
        from src.db.models import SessionEntity, AgentEntity

        db = SessionLocal()
        try:
            session = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
            if not session:
                return
            if session.status in ("running", "complete", "error", "terminated", "failed", "canceled"):
                print(f"[Temporal Stream] Session {session_id} is in status '{session.status}' — skipping workflow trigger.")
                return
            agent = db.query(AgentEntity).filter(AgentEntity.id == session.agent_id).first()
            if not agent:
                return

            inp = RedTeamInput(
                session_id=session_id,
                agent_id=agent.id,
                endpoint_url=agent.target_url,
                agent_type=agent.agent_type,
                domain=agent.domain,
                sensitivity=agent.sensitivity or "medium",
                processes_pii=agent.has_pii == "yes",
                handles_financial=agent.handles_financial or False,
                handles_medical=agent.handles_medical or False,
                has_mcp=agent.has_mcp or False,
                modalities=agent.media_types or ["text"],
                deployment_countries=agent.countries or [],
                tasks_description=agent.description or "",
            )

            client = await Client.connect(TEMPORAL_HOST)
            handle = await client.start_workflow(
                RedTeamWorkflow.run,
                inp,
                id=f"redteam-{session_id}",
                task_queue=TASK_QUEUE,
            )
            # Save workflow ID
            session.temporal_workflow_id = handle.id
            session.status = "running"
            db.commit()
            print(f"[Temporal] Started workflow {handle.id} for session {session_id}")

        finally:
            db.close()

    except Exception as e:
        print(f"[Temporal Trigger Error] {e} — falling back to background task")
        # Fallback: run attacks in background asyncio task
        asyncio.create_task(_fallback_attack_run(session_id))


async def _fallback_attack_run(session_id: str):
    """Fallback: run attacks in-process when Temporal is unavailable."""
    import uuid
    from datetime import datetime
    from src.db.session import SessionLocal
    from src.db.models import SessionEntity, AgentEntity, RedTeamProgressEntity, AttackTranscriptEntity
    from src.services.llm_orchestrator import orchestrate_attack_plan

    db = SessionLocal()
    session = None
    try:
        session = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
        agent = db.query(AgentEntity).filter(AgentEntity.id == session.agent_id).first()
        if not agent:
            return

        metadata = {
            "endpoint_url": agent.target_url,
            "agent_type": agent.agent_type,
            "domain": agent.domain,
            "sensitivity": agent.sensitivity or "medium",
            "processes_pii": agent.has_pii == "yes",
            "handles_financial": agent.handles_financial or False,
            "handles_medical": agent.handles_medical or False,
            "has_mcp": agent.has_mcp or False,
            "modalities": agent.media_types or ["text"],
            "deployment_countries": agent.countries or [],
            "tasks_description": agent.description or "",
        }

        # Orchestrate plan
        plan = await orchestrate_attack_plan(metadata)

        # Progress: orchestrated
        db.add(RedTeamProgressEntity(
            id=str(uuid.uuid4()), session_id=session_id,
            stage_id="orchestrate", stage_name="Orchestrating Attack Plan",
            stage_index=0, progress=100, message=f"Plan ready: {plan.get('rationale', '')[:100]}", done=True,
        ))
        db.commit()

        # DeepTeam in thread
        from concurrent.futures import ThreadPoolExecutor
        from src.services.deepteam_runner import DeepTeamRunner
        runner = DeepTeamRunner(
            session_id=session_id, endpoint_url=agent.target_url,
            vulnerability_names=plan.get("deepteam_vulnerabilities", ["PromptLeakage", "Toxicity"]),
            attack_names=plan.get("deepteam_attacks", ["PromptInjection"]),
            num_test_cases=plan.get("num_test_cases", 5),
        )
        loop = asyncio.get_event_loop()
        with ThreadPoolExecutor() as pool:
            await loop.run_in_executor(pool, runner.run)

        # Promptfoo in thread
        from src.services.promptfoo_runner import PromptfooRunner
        pf_runner = PromptfooRunner(
            session_id=session_id, endpoint_url=agent.target_url,
            agent_purpose=agent.description or "General AI assistant",
            plugins=plan.get("promptfoo_plugins", ["pii:direct", "hallucination"]),
            num_tests=min(plan.get("num_test_cases", 5), 5),
        )
        with ThreadPoolExecutor() as pool:
            await loop.run_in_executor(pool, pf_runner.run)

        # Finalize
        from src.services.results_aggregator import build_full_results
        results = build_full_results(session_id)
        session.confidence_score = results["confidence"]
        session.confidence_tier = results["confidence_tier"]
        session.status = "complete"
        db.commit()

    except Exception as e:
        print(f"[Fallback Attack Run Error]: {e}")
        if session:
            session.status = "error"
            db.commit()
    finally:
        db.close()


async def _poll_progress(session_id: str):
    """Poll Supabase redteam_progress for live stage updates."""
    from src.db.session import SessionLocal
    from src.db.models import RedTeamProgressEntity, SessionEntity

    db = SessionLocal()
    try:
        return db.query(RedTeamProgressEntity).filter(
            RedTeamProgressEntity.session_id == session_id
        ).order_by(RedTeamProgressEntity.stage_index).all()
    finally:
        db.close()


async def _get_session_status_async(session_id: str) -> str:
    from src.db.session import SessionLocal
    from src.db.models import SessionEntity
    db = SessionLocal()
    try:
        sess = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
        if not sess:
            return "unknown"

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

        return sess.status
    finally:
        db.close()


@router.get("/stream/{session_id}")
async def stream_redteam(session_id: str, request: Request):
    """
    SSE endpoint that:
      1. Triggers the Temporal workflow (if not already running)
      2. Polls Supabase for progress updates every 0.5s
      3. Streams stage events to client until complete, error, or terminated
    """
    async def event_generator():
        # Kick off the Temporal workflow (skipped if already running/complete)
        asyncio.create_task(_trigger_temporal_workflow(session_id))

        # Initial event
        yield _sse("stage", {
            "id": "start", "name": "Initialising evaluation engine",
            "progress": 0, "stage_index": -1, "done": False
        })

        emitted_stages = set()
        max_polls = 600  # 20 min max

        for _ in range(max_polls):
            if await request.is_disconnected():
                break

            status = await _get_session_status_async(session_id)
            stages = await _poll_progress(session_id)

            for stage in stages:
                stage_key = f"{stage.stage_id}:{stage.progress}:{stage.message}"
                if stage_key not in emitted_stages:
                    yield _sse("stage", {
                        "id": stage.stage_id,
                        "name": stage.stage_name,
                        "stage_index": stage.stage_index,
                        "progress": stage.progress,
                        "message": stage.message or "",
                        "done": stage.done,
                    })
                    emitted_stages.add(stage_key)

            if status in ("complete", "error", "terminated", "failed", "canceled"):
                if status in ("terminated", "canceled", "failed"):
                    yield _sse("terminated", {
                        "session_id": session_id,
                        "status": status,
                        "message": f"Workflow execution was {status} before pipeline completed.",
                    })
                    return
                break

            await asyncio.sleep(0.5)

        # Final complete event with full results
        results = build_full_results(session_id)
        yield _sse("complete", results)

    return StreamingResponse(
        event_generator(),
        media_type="text/event-stream",
        headers={
            "Cache-Control": "no-cache",
            "X-Accel-Buffering": "no",
            "Connection": "keep-alive",
        },
    )


@router.get("/results/{session_id}")
async def get_results(session_id: str):
    """Returns full evaluation results from Supabase."""
    return build_full_results(session_id)
