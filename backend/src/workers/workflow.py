"""
workflow.py
────────────
Temporal workflow and activity definitions for the AI Red Teaming pipeline.
"""
import uuid
import asyncio
from datetime import timedelta
from dataclasses import dataclass

from temporalio import workflow, activity
from temporalio.common import RetryPolicy


@dataclass
class RedTeamInput:
    session_id: str
    agent_id: str
    endpoint_url: str
    agent_type: str
    domain: str
    sensitivity: str
    processes_pii: bool
    handles_financial: bool
    handles_medical: bool
    has_mcp: bool
    modalities: list
    deployment_countries: list
    tasks_description: str


# ─── Activity 1: Orchestrate attacks ──────────────────────────────────────────
@activity.defn(name="orchestrate_attacks_activity")
async def orchestrate_attacks_activity(inp: RedTeamInput) -> dict:
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    import uuid
    from datetime import datetime
    from src.services.llm_orchestrator import orchestrate_attack_plan
    from src.db.session import SessionLocal
    from src.db.models import RedTeamProgressEntity, AttackPlanEntity

    db = SessionLocal()
    try:
        db.add(RedTeamProgressEntity(
            id=str(uuid.uuid4()),
            session_id=inp.session_id,
            stage_id="orchestrate",
            stage_name="Orchestrating Attack Plan",
            stage_index=0,
            progress=10,
            message="Analysing agent metadata with Groq LLM...",
            done=False,
        ))
        db.commit()

        metadata = {
            "endpoint_url": inp.endpoint_url,
            "agent_type": inp.agent_type,
            "domain": inp.domain,
            "sensitivity": inp.sensitivity,
            "processes_pii": inp.processes_pii,
            "handles_financial": inp.handles_financial,
            "handles_medical": inp.handles_medical,
            "has_mcp": inp.has_mcp,
            "modalities": inp.modalities,
            "deployment_countries": inp.deployment_countries,
            "tasks_description": inp.tasks_description,
        }
        plan = await orchestrate_attack_plan(metadata)

        db.add(AttackPlanEntity(
            id=str(uuid.uuid4()),
            session_id=inp.session_id,
            deepteam_vulnerabilities=plan.get("deepteam_vulnerabilities", []),
            deepteam_attacks=plan.get("deepteam_attacks", []),
            num_test_cases=plan.get("num_test_cases", 5),
            promptfoo_plugins=plan.get("promptfoo_plugins", []),
            rationale=plan.get("rationale", ""),
        ))

        prog = db.query(RedTeamProgressEntity).filter(
            RedTeamProgressEntity.session_id == inp.session_id,
            RedTeamProgressEntity.stage_id == "orchestrate"
        ).first()
        if prog:
            prog.progress = 100
            prog.done = True
            prog.message = f"Attack plan ready: {len(plan.get('deepteam_vulnerabilities', []))} vulns, {len(plan.get('promptfoo_plugins', []))} plugins"
            prog.updated_at = datetime.utcnow()

        db.commit()
        return plan
    finally:
        db.close()


# ─── Activity 2: DeepTeam attacks (async wrapper) ──────────────────────────────
@activity.defn(name="run_deepteam_activity")
async def run_deepteam_activity(session_id: str, endpoint_url: str, plan: dict) -> dict:
    """Async activity that offloads sync DeepTeam SDK run to a thread.
    Sends Temporal heartbeats every 10s so the server knows the activity
    is still alive during long SDK scans.
    """
    import sys, os, asyncio as _asyncio
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    from src.services.deepteam_runner import DeepTeamRunner

    result_holder: dict = {}

    def _sync_run():
        runner = DeepTeamRunner(
            session_id=session_id,
            endpoint_url=endpoint_url,
            vulnerability_names=plan.get("deepteam_vulnerabilities", ["PromptLeakage", "Toxicity"]),
            attack_names=plan.get("deepteam_attacks", ["PromptInjection", "CrescendoJailbreaking"]),
            num_test_cases=plan.get("num_test_cases", 5),
        )
        result_holder["result"] = runner.run()

    # Run SDK in background thread; heartbeat every 10s while waiting
    thread_task = _asyncio.get_event_loop().run_in_executor(None, _sync_run)
    while not thread_task.done():
        try:
            await _asyncio.wait_for(_asyncio.shield(thread_task), timeout=10)
            break
        except _asyncio.TimeoutError:
            activity.heartbeat("DeepTeam scan in progress…")

    return result_holder.get("result", {})


# ─── Activity 3: Promptfoo attacks (async wrapper) ─────────────────────────────
@activity.defn(name="run_promptfoo_activity")
async def run_promptfoo_activity(session_id: str, endpoint_url: str, purpose: str, plan: dict) -> dict:
    """Async activity that offloads sync Promptfoo CLI run to a thread.
    Sends Temporal heartbeats every 10s to prevent the server from treating
    a long-running CLI call as a dead activity.
    """
    import sys, os, asyncio as _asyncio
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    from src.services.promptfoo_runner import PromptfooRunner

    result_holder: dict = {}

    def _sync_run():
        runner = PromptfooRunner(
            session_id=session_id,
            endpoint_url=endpoint_url,
            agent_purpose=purpose,
            plugins=plan.get("promptfoo_plugins", ["pii:direct", "hallucination", "excessive-agency"]),
            num_tests=min(plan.get("num_test_cases", 5), 5),
        )
        result_holder["result"] = runner.run()

    # Run CLI in background thread; heartbeat every 10s while waiting
    thread_task = _asyncio.get_event_loop().run_in_executor(None, _sync_run)
    while not thread_task.done():
        try:
            await _asyncio.wait_for(_asyncio.shield(thread_task), timeout=10)
            break
        except _asyncio.TimeoutError:
            activity.heartbeat("Promptfoo scan in progress…")

    return result_holder.get("result", {})


# ─── Activity 4: Finalize session ──────────────────────────────────────────────
@activity.defn(name="finalize_session_activity")
async def finalize_session_activity(session_id: str) -> dict:
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    from datetime import datetime
    from src.services.results_aggregator import build_full_results
    from src.db.session import SessionLocal
    from src.db.models import SessionEntity, RedTeamProgressEntity

    results = build_full_results(session_id)

    db = SessionLocal()
    try:
        sess = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
        if sess:
            sess.confidence_score = results["confidence"]
            sess.confidence_tier = results["confidence_tier"]
            sess.status = "complete"
            sess.evaluation_summary = {
                "total_transcripts": results["total_transcripts"],
                "country_verdicts": results["country_verdicts"],
            }
            sess.updated_at = datetime.utcnow()

        db.add(RedTeamProgressEntity(
            id=str(uuid.uuid4()),
            session_id=session_id,
            stage_id="complete",
            stage_name="Evaluation Complete",
            stage_index=4,
            progress=100,
            message=f"Confidence score: {results['confidence']}% — {results['confidence_tier']}",
            done=True,
        ))
        db.commit()
    finally:
        db.close()

    return results


# ─── Workflow ─────────────────────────────────────────────────────────────────
RETRY_POLICY = RetryPolicy(maximum_attempts=2, initial_interval=timedelta(seconds=5))
LONG_TIMEOUT = timedelta(minutes=10)


@workflow.defn(name="RedTeamWorkflow")
class RedTeamWorkflow:
    @workflow.run
    async def run(self, inp: RedTeamInput) -> dict:
        plan = await workflow.execute_activity(
            orchestrate_attacks_activity,
            inp,
            schedule_to_close_timeout=timedelta(minutes=1),
            retry_policy=RETRY_POLICY,
        )

        await workflow.execute_activity(
            run_deepteam_activity,
            args=[inp.session_id, inp.endpoint_url, plan],
            schedule_to_close_timeout=LONG_TIMEOUT,
            heartbeat_timeout=timedelta(seconds=30),  # Cancel if no heartbeat for 30s
            retry_policy=RETRY_POLICY,
        )

        await workflow.execute_activity(
            run_promptfoo_activity,
            args=[inp.session_id, inp.endpoint_url, inp.tasks_description, plan],
            schedule_to_close_timeout=LONG_TIMEOUT,
            heartbeat_timeout=timedelta(seconds=30),  # Cancel if no heartbeat for 30s
            retry_policy=RETRY_POLICY,
        )

        results = await workflow.execute_activity(
            finalize_session_activity,
            inp.session_id,
            schedule_to_close_timeout=timedelta(minutes=5),
            retry_policy=RETRY_POLICY,
        )

        return results


@workflow.defn(name="ScheduledRedTeamWorkflow")
class ScheduledRedTeamWorkflow:
    """Triggered by Temporal Schedules. Dynamically creates a session record and executes RedTeamWorkflow as a child workflow."""

    @workflow.run
    async def run(self, inp: RedTeamInput) -> dict:
        sess_data = await workflow.execute_activity(
            create_scheduled_session_activity,
            inp.agent_id,
            schedule_to_close_timeout=timedelta(minutes=1),
            retry_policy=RETRY_POLICY,
        )
        if sess_data and "session_id" in sess_data:
            inp.session_id = sess_data["session_id"]
            inp.endpoint_url = sess_data.get("endpoint_url", inp.endpoint_url)
            inp.agent_type = sess_data.get("agent_type", inp.agent_type)
            inp.domain = sess_data.get("domain", inp.domain)
            inp.sensitivity = sess_data.get("sensitivity", inp.sensitivity)
            inp.tasks_description = sess_data.get("tasks_description", inp.tasks_description)

        return await workflow.execute_child_workflow(
            RedTeamWorkflow.run,
            inp,
            id=f"redteam-{inp.session_id}",
            task_queue="redteam-task-queue",
        )


# ─── Activity: Create session for scheduled runs ─────────────────────────────
@activity.defn(name="create_scheduled_session_activity")
async def create_scheduled_session_activity(agent_id: str) -> dict:
    """Creates a new session record for a scheduled periodic evaluation.
    Returns a payload dict that can be used to start a RedTeamWorkflow."""
    import sys, os
    sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))))

    import uuid
    from datetime import datetime
    from src.db.session import SessionLocal
    from src.db.models import RegisteredAgentEntity, SessionEntity, NotificationEntity

    db = SessionLocal()
    try:
        ra = db.query(RegisteredAgentEntity).filter(RegisteredAgentEntity.id == agent_id).first()
        if not ra:
            return {"error": f"Agent {agent_id} not found"}

        session_id = str(uuid.uuid4())
        session = SessionEntity(
            id=session_id,
            agent_id=agent_id,
            user_id=ra.user_id,
            status="running",
            trigger_type="periodic",
            has_own_tm=False,
        )
        db.add(session)
        ra.last_evaluated_at = datetime.utcnow()

        # Log an INFO notification to alert user that a scheduled run started
        db.add(NotificationEntity(
            id=str(uuid.uuid4()),
            user_id=ra.user_id,
            agent_id=agent_id,
            session_id=session_id,
            agent_name=ra.name,
            severity="INFO",
            title=f"Scheduled Red Teaming Started: {ra.name}",
            message=f"Automated periodic evaluation (every {ra.schedule_interval_minutes}m) initiated for agent {ra.name}.",
            failed_vulnerabilities=[],
            confidence_score=None,
            is_read=False,
            created_at=datetime.utcnow(),
        ))

        db.commit()

        return {
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
    finally:
        db.close()


# ─── Batch Workflow (chunk-based controlled parallelism) ─────────────────────
@dataclass
class BatchRedTeamInput:
    batch_id: str
    agent_inputs: list  # List of RedTeamInput dicts


BATCH_CONCURRENCY_LIMIT = 3  # Max child workflows running in parallel at once


@workflow.defn(name="BatchRedTeamWorkflow")
class BatchRedTeamWorkflow:
    """Orchestrates parallel red-team evaluations across multiple agents.

    Uses chunk-based concurrency: agents are split into groups of
    BATCH_CONCURRENCY_LIMIT and each chunk is fully awaited before the
    next chunk starts.  This keeps the workflow event-history deterministic
    (Temporal-safe) while preventing simultaneous API-rate-limit exhaustion
    from launching all N child workflows at the same instant.

    Visible in Temporal UI as one parent BatchRedTeamWorkflow with N child
    RedTeamWorkflow executions linked underneath it.
    """

    @workflow.run
    async def run(self, inp: BatchRedTeamInput) -> dict:
        agents = inp.agent_inputs
        chunks = [
            agents[i: i + BATCH_CONCURRENCY_LIMIT]
            for i in range(0, len(agents), BATCH_CONCURRENCY_LIMIT)
        ]

        completed = 0
        failed = 0

        for chunk in chunks:
            # Build all child-workflow coroutines for this chunk
            child_tasks = [
                workflow.execute_child_workflow(
                    RedTeamWorkflow.run,
                    RedTeamInput(**a),
                    id=f"redteam-{a['session_id']}",
                    task_queue="redteam-task-queue",
                )
                for a in chunk
            ]

            # Await all in this chunk before starting the next
            chunk_results = await asyncio.gather(*child_tasks, return_exceptions=True)

            completed += sum(1 for r in chunk_results if not isinstance(r, Exception))
            failed += sum(1 for r in chunk_results if isinstance(r, Exception))

        return {
            "batch_id": inp.batch_id,
            "total": len(agents),
            "completed": completed,
            "failed": failed,
            "chunks_processed": len(chunks),
        }
