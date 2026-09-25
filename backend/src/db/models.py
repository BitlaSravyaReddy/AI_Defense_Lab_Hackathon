"""
models.py — All database models for the Unified Platform.
Includes all models from both registry and red-teaming systems,
plus the new AgentVersionEventEntity for auto-retest on redeploy.
"""
import datetime
from sqlalchemy import Column, String, Float, Boolean, DateTime, JSON, Integer, Text, ForeignKey
from src.db.session import Base


# ── Users ─────────────────────────────────────────────────────────────────────
class UserEntity(Base):
    __tablename__ = "users"

    id = Column(String, primary_key=True, index=True)
    email = Column(String, unique=True, nullable=False, index=True)
    password_hash = Column(String, nullable=False)
    full_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ── Agent Registry (mirrored from registry pipeline) ──────────────────────────
class RegistryAgentEntity(Base):
    """Mirrors the Supabase 'agents' table written by arctl publish."""
    __tablename__ = "agents"

    name = Column(String, primary_key=True)
    version = Column(String, primary_key=True)
    description = Column(Text, nullable=True)
    image = Column(String, nullable=True)
    framework = Column(String, nullable=True)
    language = Column(String, nullable=True)
    model_provider = Column(String, nullable=True)
    model_name = Column(String, nullable=True)
    raw_json = Column(JSON, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ── Red Teaming Fleet ─────────────────────────────────────────────────────────
class RegisteredAgentEntity(Base):
    """Fleet record for red-teaming. Persisted in 'registered_agents'."""
    __tablename__ = "registered_agents"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=False)
    target_url = Column(String, nullable=False)
    agent_type = Column(String, default="rag")
    domain = Column(String, default="general")
    sensitivity = Column(String, default="medium")
    modalities = Column(JSON, default=list)
    deployment_countries = Column(JSON, default=list)
    processes_pii = Column(Boolean, default=False)
    handles_financial = Column(Boolean, default=False)
    handles_medical = Column(Boolean, default=False)
    has_mcp = Column(Boolean, default=False)
    mcp_tools = Column(JSON, default=list)
    tasks_description = Column(Text, nullable=True)
    schedule_interval_minutes = Column(Integer, default=60)
    is_active = Column(Boolean, default=True)
    last_evaluated_at = Column(DateTime, nullable=True)
    last_registry_version = Column(String, nullable=True)  # tracks last auto-retested version
    sync_source = Column(String, default="unified")  # "unified" | "manual" | "auto_registry"
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AgentEntity(Base):
    """Active redteam agent config used by workflows. Persisted in 'redteam_agents'."""
    __tablename__ = "redteam_agents"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    name = Column(String, nullable=True)
    target_url = Column(String, nullable=False)
    agent_type = Column(String, nullable=False)
    media_types = Column(JSON, nullable=False)
    description = Column(Text, nullable=True)
    domain = Column(String, nullable=False)
    has_pii = Column(String, nullable=False)
    countries = Column(JSON, nullable=False)
    sample_pairs = Column(JSON, nullable=True)
    architecture_diagram = Column(JSON, nullable=True)
    dataflow_diagram = Column(JSON, nullable=True)
    has_mcp = Column(Boolean, default=False)
    mcp_tools = Column(JSON, nullable=True)
    sensitivity = Column(String, default="medium")
    is_public_facing = Column(Boolean, default=True)
    handles_financial = Column(Boolean, default=False)
    handles_medical = Column(Boolean, default=False)
    schedule_interval_minutes = Column(Integer, default=60)
    is_active = Column(Boolean, default=True)
    last_evaluated_at = Column(DateTime, nullable=True)
    sync_source = Column(String, default="unified")
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class SessionEntity(Base):
    """A single red-teaming evaluation session."""
    __tablename__ = "redteam_sessions"

    id = Column(String, primary_key=True, index=True)
    agent_id = Column(String, nullable=False, index=True)
    user_id = Column(String, nullable=True, index=True)
    batch_id = Column(String, nullable=True, index=True)
    trigger_type = Column(String, default="manual")  # "manual" | "periodic" | "version_update" | "batch"
    status = Column(String, default="pending")
    has_own_tm = Column(Boolean, default=True)
    confidence_score = Column(Float, nullable=True)
    confidence_tier = Column(String, nullable=True)
    evaluation_summary = Column(JSON, nullable=True)
    temporal_workflow_id = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class ThreatModelEntity(Base):
    __tablename__ = "redteam_threat_models"

    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, nullable=False)
    stride_threats = Column(JSON, nullable=True)
    plot4ai_mapped_categories = Column(JSON, nullable=True)
    raw_json = Column(JSON, nullable=True)
    uploaded_by = Column(String, default="client")
    file_name = Column(String, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class AttackTranscriptEntity(Base):
    __tablename__ = "attack_transcripts"

    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, nullable=False, index=True)
    framework = Column(String, nullable=False)
    vulnerability = Column(String, nullable=False)
    attack_method = Column(String, nullable=False)
    turn_type = Column(String, default="single_turn")
    turn_index = Column(Integer, default=1)
    input_prompt = Column(Text, nullable=False)
    target_response = Column(Text, nullable=True)
    evaluator_score = Column(Float, default=0.0)
    passed = Column(Boolean, default=False)
    verdict = Column(String, default="FAILED")
    reasoning = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class RedTeamProgressEntity(Base):
    """Per-stage progress for SSE live updates."""
    __tablename__ = "redteam_progress"

    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, nullable=False, index=True)
    stage_id = Column(String, nullable=False)
    stage_name = Column(String, nullable=False)
    stage_index = Column(Integer, default=0)
    progress = Column(Integer, default=0)
    message = Column(Text, nullable=True)
    done = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
    updated_at = Column(DateTime, default=datetime.datetime.utcnow, onupdate=datetime.datetime.utcnow)


class AttackPlanEntity(Base):
    __tablename__ = "attack_plans"

    id = Column(String, primary_key=True, index=True)
    session_id = Column(String, nullable=False, index=True)
    deepteam_vulnerabilities = Column(JSON, nullable=True)
    deepteam_attacks = Column(JSON, nullable=True)
    num_test_cases = Column(Integer, default=5)
    promptfoo_plugins = Column(JSON, nullable=True)
    rationale = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


class NotificationEntity(Base):
    __tablename__ = "notifications"

    id = Column(String, primary_key=True, index=True)
    user_id = Column(String, nullable=True, index=True)
    agent_id = Column(String, nullable=False, index=True)
    session_id = Column(String, nullable=False, index=True)
    agent_name = Column(String, nullable=False)
    severity = Column(String, default="HIGH")
    title = Column(String, nullable=False)
    message = Column(Text, nullable=False)
    failed_vulnerabilities = Column(JSON, default=list)
    confidence_score = Column(Float, nullable=True)
    is_read = Column(Boolean, default=False)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)


# ── NEW: Agent Version Events for auto-retest on redeploy ─────────────────────
class AgentVersionEventEntity(Base):
    """
    Written whenever publish_all() successfully publishes a new agent version.
    The version_webhook route reads these events and auto-triggers red-team
    evaluation for the agent if a RegisteredAgentEntity exists with the same name.
    """
    __tablename__ = "agent_version_events"

    id = Column(String, primary_key=True, index=True)
    agent_name = Column(String, nullable=False, index=True)  # matches registered_agents.name
    registry_agent_name = Column(String, nullable=True)       # safe_name from publish_all
    new_version = Column(String, nullable=False)              # e.g. "1.0.20260921120000"
    previous_version = Column(String, nullable=True)
    endpoint_url = Column(String, nullable=True)             # target URL from registered_agents
    triggered_session_id = Column(String, nullable=True)     # session created for this retest
    status = Column(String, default="pending")               # "pending" | "triggered" | "skipped" | "failed"
    error_message = Column(Text, nullable=True)
    created_at = Column(DateTime, default=datetime.datetime.utcnow)
