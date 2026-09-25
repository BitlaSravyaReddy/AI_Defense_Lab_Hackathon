import json
import uuid
from typing import List, Dict, Any

STRIDE_TO_PLOT4AI = {
    "Spoofing": "Cybersecurity",
    "Tampering": "Data Governance",
    "Repudiation": "Accountability & Human Oversight",
    "Information Disclosure": "Privacy & Data Protection",
    "Denial of Service": "Safety & Environmental Impact",
    "Elevation of Privilege": "Cybersecurity"
}

STRIDE_TO_DEEPTEAM_VULNS = {
    "Spoofing": ["AgentIdentityAbuse", "PromptInjection"],
    "Tampering": ["IndirectInstruction", "Robustness"],
    "Repudiation": ["ExcessiveAgency", "Ethics"],
    "Information Disclosure": ["PIILeakage", "PromptLeakage", "CrossContextRetrieval"],
    "Denial of Service": ["ToolOrchestrationAbuse", "SystemReconnaissance"],
    "Elevation of Privilege": ["ExploitToolAgent", "RBAC", "BOLA", "BFLA"]
}

def parse_threat_dragon_graph(raw_json: Dict[str, Any]) -> Dict[str, Any]:
    """
    Parses Threat Dragon v2 JSON schema and extracts threats, STRIDE categories,
    and target diagram components.
    """
    stride_threats = []
    mapped_categories = set()
    mapped_vulnerabilities = set()

    diagrams = raw_json.get("detail", {}).get("diagrams", [])
    if not diagrams and "diagrams" in raw_json:
        diagrams = raw_json["diagrams"]

    for diag in diagrams:
        cells = diag.get("cells", [])
        for cell in cells:
            cell_name = cell.get("attrs", {}).get("text", {}).get("text", cell.get("id", "Unknown Element"))
            threats = cell.get("threats", [])
            for threat in threats:
                t_title = threat.get("title", "Untitled Threat")
                t_stride = threat.get("type", "Information Disclosure")
                t_status = threat.get("status", "Open")
                t_desc = threat.get("description", "")

                plot4ai_cat = STRIDE_TO_PLOT4AI.get(t_stride, "Cybersecurity")
                vulns = STRIDE_TO_DEEPTEAM_VULNS.get(t_stride, ["PromptInjection"])

                mapped_categories.add(plot4ai_cat)
                mapped_vulnerabilities.update(vulns)

                stride_threats.append({
                    "id": threat.get("id", str(uuid.uuid4())),
                    "title": t_title,
                    "stride_category": t_stride,
                    "target_element": cell_name,
                    "status": t_status,
                    "description": t_desc,
                    "mapped_plot4ai_category": plot4ai_cat,
                    "mapped_vulnerabilities": vulns
                })

    return {
        "stride_threats": stride_threats,
        "mapped_categories": list(mapped_categories),
        "mapped_vulnerabilities": list(mapped_vulnerabilities)
    }
