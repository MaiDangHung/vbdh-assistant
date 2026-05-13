"""Analyze endpoint - Xử lý văn bản"""

import logging
from fastapi import APIRouter, HTTPException
from pydantic import BaseModel
from typing import List, Optional
from app.services.ai_processor import process_text

logger = logging.getLogger(__name__)
router = APIRouter()


class AnalyzeRequest(BaseModel):
    text: str
    tasks: List[str] = ["summarize", "extract_tasks"]


class AnalyzeResponse(BaseModel):
    summary: str
    tasks: List[str]
    raw_response: Optional[str] = None


@router.post("/analyze", response_model=AnalyzeResponse)
async def analyze_text(request: AnalyzeRequest):
    """
    Xử lý văn bản:
    - summarize: Tóm tắt nội dung chính
    - extract_tasks: Trích xuất danh sách nhiệm vụ
    """
    logger.info(f"Analyze request: text_length={len(request.text)}, tasks={request.tasks}")

    try:
        result = await process_text(request.text, request.tasks)
        return AnalyzeResponse(
            summary=result["summary"],
            tasks=result["tasks"],
            raw_response=result.get("raw_response"),
        )
    except Exception as e:
        logger.error(f"Analysis failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
