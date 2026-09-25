"""
registry_publisher.py — Registry publish logic (clone of pipeline.py publish_all).
Scans a local directory for agent.yaml, prompts.json, skills/*.md, mcpserver/
and publishes them via arctl + REST daemon, then writes to Supabase.
"""
import asyncio
import csv
import io
import json
import subprocess
import re
from datetime import datetime, timezone
from pathlib import Path
from typing import Optional

import httpx

from src.config import settings
from src.db.supabase_client import db_upsert, _sanitize

ARCTL = settings.ARCTL
DAEMON_URL = settings.DAEMON_URL


async def run_cmd(cmd: list[str], cwd: str) -> dict:
    proc = await asyncio.create_subprocess_exec(
        *cmd, cwd=cwd,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE,
    )
    stdout, stderr = await proc.communicate()
    return {
        "cmd": " ".join(cmd),
        "returncode": proc.returncode,
        "stdout": stdout.decode().strip(),
        "stderr": stderr.decode().strip(),
    }


def sanitize_compose_file(compose_path: Path):
    if not compose_path.exists():
        return
    try:
        content = compose_path.read_text()
        cleaned = re.sub(r'ports:\s*\n(\s*-\s*[\'"]?\d+:?\d*[\'"]?)', r'expose:\n\1', content)
        cleaned = re.sub(r'[\'"]?\d+:(\d+)[\'"]?', r'"\1"', cleaned)
        if cleaned != content:
            compose_path.write_text(cleaned)
    except Exception as ex:
        print(f"[Publisher] compose sanitize error: {ex}")


def parse_results(content: bytes, filename: str) -> list[dict]:
    """Parse JSON or CSV result file into list of test case dicts."""
    if filename.endswith(".json"):
        return json.loads(content.decode())
    elif filename.endswith(".csv"):
        reader = csv.DictReader(io.StringIO(content.decode()))
        rows = []
        for row in reader:
            for k in ("passed", "vulnerable"):
                if k in row:
                    row[k] = row[k].lower() in ("true", "1", "yes")
            for k in ("score",):
                if k in row:
                    try:
                        row[k] = float(row[k]) if row[k] not in ("", "None", "null") else None
                    except Exception:
                        row[k] = None
            rows.append(row)
        return rows
    raise ValueError(f"Unsupported file type: {filename}")


def compute_pass_rate(cases: list[dict]) -> dict:
    total = len(cases)
    evaluated = sum(1 for c in cases if c.get("score") is not None)
    passed = sum(1 for c in cases if c.get("passed") is True or c.get("score") == 1.0)
    rate = (passed / evaluated) if evaluated > 0 else 0.0
    return {"total": total, "evaluated": evaluated, "passed": passed, "rate": rate}


async def resolve_location(location: str, branch: str, dest_name: str) -> Path:
    """Clone or update a git repo, or use a local path."""
    import tempfile
    base = Path(tempfile.gettempdir()) / "unified_registry"
    base.mkdir(parents=True, exist_ok=True)

    if location.startswith("http") or location.startswith("git@"):
        dest = base / dest_name
        if dest.exists():
            await run_cmd(["git", "fetch", "--all"], str(dest))
            await run_cmd(["git", "checkout", branch], str(dest))
            await run_cmd(["git", "pull", "origin", branch], str(dest))
        else:
            proc = await asyncio.create_subprocess_exec(
                "git", "clone", "--branch", branch, location, str(dest),
                stdout=asyncio.subprocess.PIPE,
                stderr=asyncio.subprocess.PIPE,
            )
            _, err = await proc.communicate()
            if proc.returncode != 0:
                raise RuntimeError(f"git clone failed: {err.decode()}")
        return dest
    else:
        p = Path(location)
        if not p.exists():
            raise FileNotFoundError(f"Local path not found: {location}")
        return p


async def publish_all(
    base_dir: Path,
    name_overrides: Optional[dict] = None,
    run_ts: Optional[str] = None,
) -> tuple[list[dict], dict]:
    """
    Dynamically scan base_dir for prompts, skills, MCP server, and agent.
    Builds Docker images via arctl and registers via REST daemon.
    Returns (steps, deployed_versions).
    """
    import yaml as _yaml

    name_overrides = name_overrides or {}
    steps = []
    deployed_versions: dict = {"agents": [], "servers": [], "skills": [], "prompts": []}

    if run_ts is None:
        run_ts = datetime.now(timezone.utc).strftime("%Y%m%d%H%M%S")

    # Sanitize docker-compose files
    for c_file in base_dir.glob("**/docker-compose*.y*ml"):
        sanitize_compose_file(c_file)

    # ── 1. Prompts ─────────────────────────────────────────────────────────────
    prompt_refs = []
    prompt_file = next(
        iter([base_dir / "prompts.json"] + list(base_dir.glob("**/prompts.json"))),
        None
    )
    if prompt_file and prompt_file.exists():
        try:
            prompts = json.loads(prompt_file.read_text())
            if not isinstance(prompts, list):
                prompts = [prompts]
            user_pnames = [n.strip() for n in (name_overrides.get("prompt_names") or "").split(",") if n.strip()]
            for idx, p in enumerate(prompts):
                raw_pname = p.get("name", "prompt")
                pname = user_pnames[idx] if idx < len(user_pnames) else raw_pname
                pver = f"1.0.{run_ts}"
                pcontent = p.get("content", "")
                pdesc = p.get("description", "Imported Prompt")

                resp = httpx.post(f"{DAEMON_URL}/v0/prompts", json={
                    "name": pname, "version": pver, "content": pcontent, "description": pdesc
                }, timeout=30.0)

                if resp.is_success:
                    steps.append({"cmd": f"POST /v0/prompts ({pname})", "returncode": 0, "stdout": resp.text, "stderr": ""})
                    prompt_refs.append({"name": pname, "registryPromptName": pname, "registryPromptVersion": pver})
                    deployed_versions["prompts"].append({"name": pname, "version": pver})
                    db_upsert("prompts", {
                        "name": pname, "version": pver, "description": pdesc,
                        "content": pcontent, "raw_json": json.dumps(_sanitize(p), default=str)
                    }, on_conflict="name,version")
                else:
                    steps.append({"cmd": f"POST /v0/prompts ({pname})", "returncode": resp.status_code, "stdout": "", "stderr": resp.text})
        except Exception as ex:
            steps.append({"cmd": "prompt publish", "returncode": -1, "stderr": str(ex), "stdout": ""})

    # ── 2. Skills ──────────────────────────────────────────────────────────────
    skill_refs = []
    skills_dir = next(
        (d for d in [base_dir / "skills"] + list(base_dir.glob("**/skills")) if d.is_dir()),
        None
    )
    if skills_dir:
        try:
            skill_files = list(skills_dir.glob("*.md"))
            user_snames = [n.strip() for n in (name_overrides.get("skill_names") or "").split(",") if n.strip()]
            for sidx, sf in enumerate(skill_files):
                raw_skill = re.sub(r"[^a-zA-Z0-9]", "", sf.stem)
                skill_name = user_snames[sidx] if sidx < len(user_snames) else raw_skill
                skill_version = f"1.0.{run_ts}"

                resp = httpx.post(f"{DAEMON_URL}/v0/skills", json={
                    "name": skill_name, "version": skill_version,
                    "description": f"Skill: {sf.stem}",
                    "packages": [{"registryType": "docker", "identifier": f"truviq/{skill_name}:{skill_version}", "version": skill_version, "transport": {"type": "stdio"}}]
                }, timeout=30.0)

                if resp.is_success:
                    steps.append({"cmd": f"POST /v0/skills ({skill_name})", "returncode": 0, "stdout": resp.text, "stderr": ""})
                    skill_refs.append({"name": skill_name, "registrySkillName": skill_name, "registrySkillVersion": skill_version})
                    deployed_versions["skills"].append({"name": skill_name, "version": skill_version})
                    db_upsert("skills", {
                        "name": skill_name, "version": skill_version, "description": f"Skill: {sf.stem}",
                        "packages": json.dumps([{"registryType": "docker", "identifier": f"truviq/{skill_name}:{skill_version}", "version": skill_version, "transport": {"type": "stdio"}}]),
                        "raw_json": json.dumps({"name": skill_name, "file": sf.name})
                    }, on_conflict="name,version")
                else:
                    steps.append({"cmd": f"POST /v0/skills ({skill_name})", "returncode": resp.status_code, "stdout": "", "stderr": resp.text})
        except Exception as ex:
            steps.append({"cmd": "skill publish", "returncode": -1, "stderr": str(ex), "stdout": ""})

    # ── 3. MCP Server ──────────────────────────────────────────────────────────
    mcp_servers_ref = []
    mcp_dir = None
    if (base_dir / "mcpserver").exists():
        mcp_dir = base_dir / "mcpserver"
    elif (base_dir / "server.json").exists():
        mcp_dir = base_dir
    else:
        for p in base_dir.glob("**/server.json"):
            mcp_dir = p.parent
            break

    if mcp_dir:
        MCP_ORG = "truviq"
        raw_mcp_name = mcp_dir.name.lower()
        if raw_mcp_name == "agentregistry":
            raw_mcp_name = "mcpserver"
        user_server_name = (name_overrides.get("server_name") or "").strip()
        MCP_NAME = re.sub(r"[^a-z0-9]", "", user_server_name) if user_server_name else raw_mcp_name
        MCP_IMAGE = f"{MCP_ORG}/{MCP_NAME}:latest"
        mcp_version = f"1.0.{run_ts}"

        r = await run_cmd([ARCTL, "mcp", "build", str(mcp_dir), "--image", MCP_IMAGE], str(mcp_dir))
        steps.append(r)

        try:
            resp = httpx.post(f"{DAEMON_URL}/v0/servers", json={
                "$schema": "https://static.modelcontextprotocol.io/schemas/2025-10-17/server.schema.json",
                "name": f"{MCP_ORG}/{MCP_NAME}", "description": f"MCP server {mcp_dir.name}",
                "version": mcp_version,
                "packages": [{"registryType": "oci", "identifier": MCP_IMAGE, "version": mcp_version, "transport": {"type": "stdio"}}]
            }, timeout=30.0)
            if resp.is_success:
                steps.append({"cmd": f"POST /v0/servers ({MCP_ORG}/{MCP_NAME})", "returncode": 0, "stdout": resp.text, "stderr": ""})
                mcp_servers_ref.append({"type": "command", "name": MCP_NAME, "image": MCP_IMAGE,
                                        "command": "python3", "args": ["/app/server.py"],
                                        "registryServerName": f"{MCP_ORG}/{MCP_NAME}", "registryServerVersion": mcp_version})
                deployed_versions["servers"].append({"name": f"{MCP_ORG}/{MCP_NAME}", "version": mcp_version})
                db_upsert("mcp_servers", {
                    "name": f"{MCP_ORG}/{MCP_NAME}", "version": mcp_version, "description": f"MCP server {mcp_dir.name}",
                    "packages": json.dumps([{"registryType": "oci", "identifier": MCP_IMAGE, "version": mcp_version, "transport": {"type": "stdio"}}]),
                    "raw_json": json.dumps({"name": MCP_NAME, "image": MCP_IMAGE})
                }, on_conflict="name,version")
            else:
                steps.append({"cmd": f"POST /v0/servers ({MCP_ORG}/{MCP_NAME})", "returncode": resp.status_code, "stdout": "", "stderr": resp.text})
        except Exception as ex:
            steps.append({"cmd": "mcp publish", "returncode": -1, "stderr": str(ex), "stdout": ""})

    # ── 4. Agent ───────────────────────────────────────────────────────────────
    agent_yaml_path = None
    if (base_dir / "agent.yaml").exists():
        agent_yaml_path = base_dir / "agent.yaml"
    else:
        for p in base_dir.glob("**/agent.yaml"):
            agent_yaml_path = p
            break

    safe_name = None
    agent_version = None

    if agent_yaml_path:
        agent_dir = agent_yaml_path.parent
        agent_meta = {}
        try:
            agent_meta = _yaml.safe_load(agent_yaml_path.read_text()) or {}
        except Exception:
            pass

        raw_name = agent_meta.get("agentName", "agent")
        user_agent_name = (name_overrides.get("agent_name") or "").strip()
        safe_name = re.sub(r"[^a-zA-Z0-9]", "", user_agent_name if user_agent_name else raw_name)
        if not safe_name or not safe_name[0].isalpha():
            safe_name = "a" + safe_name

        agent_version = f"1.0.{run_ts}"
        agent_image = agent_meta.get("image", "ghcr.io/myagent:latest")
        agent_desc = agent_meta.get("description", "AI Agent")

        r = await run_cmd([ARCTL, "agent", "build", str(agent_dir)], str(agent_dir))
        steps.append(r)

        try:
            resp = httpx.post(f"{DAEMON_URL}/v0/agents", json={
                "name": safe_name, "version": agent_version, "image": agent_image,
                "language": agent_meta.get("language", "python"),
                "framework": agent_meta.get("framework", "adk"),
                "modelProvider": agent_meta.get("modelProvider", "gemini"),
                "modelName": agent_meta.get("modelName", "gemini-2.0-flash"),
                "description": agent_desc,
                "mcpServers": agent_meta.get("mcpServers", []) or mcp_servers_ref,
                "skills": agent_meta.get("skills", []) or skill_refs,
                "prompts": agent_meta.get("prompts", []) or prompt_refs,
                "repository": {"url": "local", "source": "local"}
            }, timeout=30.0)

            if resp.is_success:
                steps.append({"cmd": f"POST /v0/agents ({safe_name})", "returncode": 0, "stdout": resp.text, "stderr": ""})
                deployed_versions["agents"].append({"name": safe_name, "version": agent_version})
                db_upsert("agents", {
                    "name": safe_name, "version": agent_version, "description": agent_desc,
                    "image": agent_image, "framework": agent_meta.get("framework", "adk"),
                    "language": agent_meta.get("language", "python"),
                    "model_provider": agent_meta.get("modelProvider", "gemini"),
                    "model_name": agent_meta.get("modelName", "gemini-2.0-flash"),
                    "raw_json": json.dumps(_sanitize(agent_meta), default=str)
                }, on_conflict="name,version")
            else:
                steps.append({"cmd": f"POST /v0/agents ({safe_name})", "returncode": resp.status_code, "stdout": "", "stderr": resp.text})
        except Exception as ex:
            steps.append({"cmd": "agent publish", "returncode": -1, "stderr": str(ex), "stdout": ""})

    return steps, deployed_versions, safe_name, agent_version
