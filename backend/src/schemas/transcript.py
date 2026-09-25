from typing import List, Optional
from pydantic import BaseModel

class AttackTranscriptItem(BaseModel):
    id: str
    session_id: str
    framework: str
    vulnerability: str
    attack_method: str
    turn_type: str
    turn_index: int
    input_prompt: str
    target_response: Optional[str]
    evaluator_score: float
    passed: bool
    verdict: str
    reasoning: Optional[str]
    created_at: str

class ExportTranscriptsResponse(BaseModel):
    session_id: str
    total_transcripts: int
    transcripts: List[AttackTranscriptItem]
