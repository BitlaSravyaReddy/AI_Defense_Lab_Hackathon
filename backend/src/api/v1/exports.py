import io
import csv
from fastapi import APIRouter, Depends
from fastapi.responses import StreamingResponse
from sqlalchemy.orm import Session
from src.db.session import get_db
from src.db.models import AttackTranscriptEntity
from src.schemas.transcript import ExportTranscriptsResponse, AttackTranscriptItem

router = APIRouter(prefix="/sessions", tags=["Transcript Exports"])

@router.get("/{session_id}/export/json", response_model=ExportTranscriptsResponse)
async def export_transcripts_json(session_id: str, db: Session = Depends(get_db)):
    """Exports all multi-turn and single-turn conversation transcripts as formatted JSON."""
    transcripts = db.query(AttackTranscriptEntity).filter(AttackTranscriptEntity.session_id == session_id).order_by(AttackTranscriptEntity.turn_index.asc()).all()

    items = []
    for t in transcripts:
        items.append(AttackTranscriptItem(
            id=t.id,
            session_id=t.session_id,
            framework=t.framework,
            vulnerability=t.vulnerability,
            attack_method=t.attack_method,
            turn_type=t.turn_type,
            turn_index=t.turn_index,
            input_prompt=t.input_prompt,
            target_response=t.target_response,
            evaluator_score=t.evaluator_score,
            passed=t.passed,
            verdict=t.verdict,
            reasoning=t.reasoning,
            created_at=t.created_at.isoformat() if t.created_at else ""
        ))

    return ExportTranscriptsResponse(
        session_id=session_id,
        total_transcripts=len(items),
        transcripts=items
    )


@router.get("/{session_id}/export/csv")
async def export_transcripts_csv(session_id: str, db: Session = Depends(get_db)):
    """Generates and streams downloadable CSV file of all attack conversation transcripts."""
    transcripts = db.query(AttackTranscriptEntity).filter(AttackTranscriptEntity.session_id == session_id).order_by(AttackTranscriptEntity.turn_index.asc()).all()

    output = io.StringIO()
    writer = csv.writer(output)
    writer.writerow([
        "session_id", "framework", "vulnerability", "attack_method",
        "turn_type", "turn_index", "input_prompt", "target_response",
        "evaluator_score", "passed", "verdict", "reasoning", "created_at"
    ])

    for t in transcripts:
        writer.writerow([
            t.session_id, t.framework, t.vulnerability, t.attack_method,
            t.turn_type, t.turn_index, t.input_prompt, t.target_response,
            t.evaluator_score, t.passed, t.verdict, t.reasoning,
            t.created_at.isoformat() if t.created_at else ""
        ])

    output.seek(0)
    return StreamingResponse(
        iter([output.getvalue()]),
        media_type="text/csv",
        headers={"Content-Disposition": f"attachment; filename=attack_transcripts_{session_id[:8]}.csv"}
    )
