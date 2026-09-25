"""
temporal_scheduler.py — Temporal Schedule CRUD with primary/fallback host logic.
Tries TEMPORAL_HOST first (localhost:7233)
(local dev Temporal server started via `temporal server start-dev`).
"""
import os
from datetime import timedelta
from typing import Optional

from src.config import settings

TASK_QUEUE = "redteam-task-queue"


def _schedule_id(agent_id: str) -> str:
    return f"schedule-agent-{agent_id}"


async def _get_client():
    """Connects to Temporal, trying primary then fallback host."""
    from temporalio.client import Client

    hosts = [settings.TEMPORAL_HOST, settings.TEMPORAL_HOST_FALLBACK]
    last_err = None
    for host in hosts:
        try:
            client = await Client.connect(host)
            print(f"[Temporal] Connected to {host}")
            return client
        except Exception as e:
            last_err = e
            print(f"[Temporal] Could not connect to {host}: {e}")
    raise RuntimeError(f"No Temporal server reachable. Last error: {last_err}")


async def create_agent_schedule(agent_id: str, interval_minutes: int, payload: dict) -> str:
    """Create a Temporal Schedule that periodically triggers RedTeamWorkflow."""
    from temporalio.client import (
        Schedule, ScheduleActionStartWorkflow, ScheduleSpec,
        ScheduleIntervalSpec, ScheduleState, SchedulePolicy, ScheduleOverlapPolicy,
    )
    from src.workers.workflow import RedTeamInput

    client = await _get_client()
    schedule_id = _schedule_id(agent_id)
    effective_interval = max(interval_minutes or 60, 1)

    inp = RedTeamInput(
        session_id="",
        agent_id=agent_id,
        endpoint_url=payload.get("endpoint_url", ""),
        agent_type=payload.get("agent_type", "rag"),
        domain=payload.get("domain", "general"),
        sensitivity=payload.get("sensitivity", "medium"),
        processes_pii=payload.get("processes_pii", False),
        handles_financial=payload.get("handles_financial", False),
        handles_medical=payload.get("handles_medical", False),
        has_mcp=payload.get("has_mcp", False),
        modalities=payload.get("modalities", ["text"]),
        deployment_countries=payload.get("deployment_countries", ["us"]),
        tasks_description=payload.get("tasks_description", ""),
    )

    try:
        await client.create_schedule(
            schedule_id,
            Schedule(
                action=ScheduleActionStartWorkflow(
                    "ScheduledRedTeamWorkflow",
                    inp,
                    id=f"scheduled-redteam-{agent_id}-{{{{.ScheduledTime.Unix}}}}",
                    task_queue=TASK_QUEUE,
                ),
                spec=ScheduleSpec(
                    intervals=[ScheduleIntervalSpec(every=timedelta(minutes=effective_interval))],
                ),
                state=ScheduleState(note=f"Periodic red team for agent {agent_id}"),
                policy=SchedulePolicy(overlap=ScheduleOverlapPolicy.SKIP),
            ),
        )
        print(f"[Temporal] Created schedule '{schedule_id}' every {effective_interval}m")
    except Exception as e:
        if "already running" in str(e).lower() or "already exists" in str(e).lower():
            print(f"[Temporal] Schedule '{schedule_id}' exists — updating interval.")
            await update_agent_schedule(agent_id, interval_minutes)
        else:
            print(f"[Temporal] Error creating schedule: {e}")
            raise

    return schedule_id


async def update_agent_schedule(agent_id: str, interval_minutes: int) -> None:
    from temporalio.client import ScheduleSpec, ScheduleIntervalSpec

    client = await _get_client()
    schedule_id = _schedule_id(agent_id)
    effective_interval = max(interval_minutes or 60, 1)

    try:
        handle = client.get_schedule_handle(schedule_id)

        async def _updater(input):
            sched = input.description.schedule
            sched.spec = ScheduleSpec(
                intervals=[ScheduleIntervalSpec(every=timedelta(minutes=effective_interval))],
            )
            return sched

        await handle.update(_updater)
        print(f"[Temporal] Updated schedule '{schedule_id}' to {effective_interval}m")
    except Exception as e:
        print(f"[Temporal] Error updating schedule '{schedule_id}': {e}")
        raise


async def pause_agent_schedule(agent_id: str) -> None:
    client = await _get_client()
    handle = client.get_schedule_handle(_schedule_id(agent_id))
    try:
        await handle.pause(note="Paused by user")
    except Exception as e:
        print(f"[Temporal] Pause error: {e}")


async def resume_agent_schedule(agent_id: str) -> None:
    client = await _get_client()
    handle = client.get_schedule_handle(_schedule_id(agent_id))
    try:
        await handle.unpause(note="Resumed by user")
    except Exception as e:
        print(f"[Temporal] Resume error: {e}")


async def delete_agent_schedule(agent_id: str) -> None:
    client = await _get_client()
    handle = client.get_schedule_handle(_schedule_id(agent_id))
    try:
        await handle.delete()
    except Exception as e:
        print(f"[Temporal] Delete error: {e}")


async def get_schedule_info(agent_id: str) -> Optional[dict]:
    try:
        client = await _get_client()
        handle = client.get_schedule_handle(_schedule_id(agent_id))
        desc = await handle.describe()
        return {
            "schedule_id": _schedule_id(agent_id),
            "is_paused": desc.schedule.state.paused if desc.schedule.state else False,
            "note": desc.schedule.state.note if desc.schedule.state else "",
            "num_actions_taken": desc.info.num_actions,
            "next_action_times": [str(t) for t in (desc.info.next_action_times or [])],
        }
    except Exception as e:
        print(f"[Temporal] get_schedule_info error: {e}")
        return None
