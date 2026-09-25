from typing import Dict, Any, List, Optional
from pydantic import BaseModel

class ThreatItem(BaseModel):
    id: str
    title: str
    stride_category: str
    target_element: str
    status: str
    description: str
    mapped_plot4ai_category: str
    mapped_vulnerabilities: List[str]

class ThreatModelUploadResponse(BaseModel):
    status: str
    filename: str
    stride_threats_count: int
    mapped_categories: List[str]
