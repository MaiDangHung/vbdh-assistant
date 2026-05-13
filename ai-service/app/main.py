"""VBDH Assistant - AI Service (FastAPI)"""

import os
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from app.routers import analyze
from app.config import settings

app = FastAPI(
    title="VBDH Assistant - AI Service",
    description="Xử lý văn bản điều hành: tóm tắt, trích xuất nhiệm vụ, gợi ý phòng ban",
    version="1.0.0",
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_methods=["*"],
    allow_headers=["*"],
)

# Router
app.include_router(analyze.router, prefix="/api/v1", tags=["analyze"])


@app.get("/health")
async def health():
    return {"status": "UP", "service": "vbdh-assistant-ai"}


if __name__ == "__main__":
    import uvicorn
    uvicorn.run("app.main:app", host="0.0.0.0", port=8000, reload=True)
