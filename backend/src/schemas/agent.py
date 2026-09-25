from typing import List, Optional, Dict, Any
from pydantic import BaseModel, HttpUrl

class SamplePair(BaseModel):
    input_prompt: str
    expected_output: str

class DiagramInput(BaseModel):
    type: str = "plantuml"
    code: str

class AgentRegisterRequest(BaseModel):
    name: str = "AI Agent"
    endpoint_url: str
    agent_type: str = "rag"
    has_mcp: bool = False
    mcp_tools: Optional[List[str]] = []
    modalities: Optional[List[str]] = ["text"]
    domain: str = "general"
    domain_custom: Optional[str] = ""
    tasks_description: str
    sample_inputs: Optional[List[str]] = []
    sample_outputs: Optional[List[str]] = []
    sample_pairs: Optional[List[SamplePair]] = []
    sensitivity: str = "medium"
    deployment_countries: Optional[List[str]] = ["us"]
    is_public_facing: bool = True
    processes_pii: bool = False
    handles_financial: bool = False
    handles_medical: bool = False
    arch_code: Optional[str] = ""
    arch_type: Optional[str] = "plantuml"
    dataflow_code: Optional[str] = ""
    dataflow_type: Optional[str] = "plantuml"
    has_own_threat_model: bool = False
    schedule_interval_minutes: int = 60


class AgentRegisterResponse(BaseModel):
    session_id: str
    agent_id: str
    status: str
    message: str = "Agent successfully registered for red teaming evaluation."
