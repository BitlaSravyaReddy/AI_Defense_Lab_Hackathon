import uuid
import json
from fastapi import APIRouter, UploadFile, File, HTTPException, Depends
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import SessionEntity, ThreatModelEntity
from src.schemas.threat_model import ThreatModelUploadResponse
from src.services.threat_dragon_parser import parse_threat_dragon_graph

router = APIRouter(prefix="/sessions", tags=["Threat Dragon Models"])

@router.post("/{session_id}/upload-threat-model", response_model=ThreatModelUploadResponse)
async def upload_threat_model(session_id: str, file: UploadFile = File(...), db: Session = Depends(get_db)):
    """Uploads Threat Dragon v2 JSON, parses STRIDE threats, and updates session status."""
    if not file.filename.endswith(".json"):
        raise HTTPException(400, "Only .json files accepted.")

    contents = await file.read()
    try:
        raw_json = json.loads(contents.decode("utf-8"))
    except Exception:
        raise HTTPException(400, "Invalid JSON file format.")

    parsed = parse_threat_dragon_graph(raw_json)

    try:
        tm_record = ThreatModelEntity(
            id=str(uuid.uuid4()),
            session_id=session_id,
            stride_threats=parsed["stride_threats"],
            plot4ai_mapped_categories=parsed["mapped_categories"],
            raw_json=raw_json,
            uploaded_by="client",
            file_name=file.filename
        )
        db.add(tm_record)

        sess_db = db.query(SessionEntity).filter(SessionEntity.id == session_id).first()
        if sess_db:
            sess_db.status = "threat_model_ready"
        db.commit()
    except Exception as e:
        print(f"[Database Threat Model Error]: {e}")
        db.rollback()

    return ThreatModelUploadResponse(
        status="uploaded",
        filename=file.filename,
        stride_threats_count=len(parsed["stride_threats"]),
        mapped_categories=parsed["mapped_categories"]
    )
