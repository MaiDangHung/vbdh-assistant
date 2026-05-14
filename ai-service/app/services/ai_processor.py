"""AI Processor - Gọi GLM model qua Anthropic-compatible API (cùng tbkl-hoatien)"""

import logging
import httpx
from app.config import settings

logger = logging.getLogger(__name__)

SUMMARY_PROMPT = """Bạn là trợ lý xử lý văn bản điều hành. Hãy đọc văn bản sau và:

1. TÓM TẮT nội dung chính của văn bản (không quá 3-5 câu)
2. TRÍCH XUẤT danh sách các nhiệm vụ cần thực hiện (mỗi nhiệm vụ trên 1 dòng, bắt đầu bằng dấu -)

Văn bản:
{text}

Hãy trả lời theo định dạng sau:
TÓM TẮT:
[tóm tắt ở đây]

NHIỆM VỤ:
- [nhiệm vụ 1]
- [nhiệm vụ 2]
- ...
"""


async def process_text(text: str, tasks: list) -> dict:
    """Gọi AI để xử lý văn bản"""
    prompt = SUMMARY_PROMPT.format(text=text)
    result = await call_glm(prompt)
    summary, task_list = parse_response(result)

    return {
        "summary": summary,
        "tasks": task_list,
        "raw_response": result,
    }


async def call_glm(prompt: str) -> str:
    """
    Gọi GLM model qua Anthropic-compatible API (z.ai)
    Giống hệt cách tbkl-hoatien gọi AI
    """
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{settings.glm_base_url}/v1/messages",
                headers={
                    "x-api-key": settings.glm_api_key,
                    "anthropic-version": "2023-06-01",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.ai_model,
                    "max_tokens": 2000,
                    "messages": [
                        {
                            "role": "user",
                            "content": f"Bạn là trợ lý xử lý văn bản điều hành của cơ quan nhà nước. Hãy trả lời bằng tiếng Việt.\n\n{prompt}",
                        },
                    ],
                },
            )
            response.raise_for_status()
            data = response.json()

            # Anthropic format: response.content[0].text
            return data["content"][0]["text"]

    except httpx.HTTPStatusError as e:
        logger.error(f"GLM API HTTP error: {e.response.status_code} - {e.response.text}")
        raise Exception(f"Lỗi gọi AI: HTTP {e.response.status_code}")
    except httpx.HTTPError as e:
        logger.error(f"GLM API error: {e}")
        raise Exception(f"Lỗi gọi AI service: {e}")


def parse_response(response: str) -> tuple:
    """Parse AI response thành summary và tasks"""
    summary = ""
    tasks = []
    lines = response.split("\n")
    current_section = None

    for line in lines:
        line = line.strip()

        if "TÓM TẮT:" in line.upper() or "TÓM TẮT :" in line.upper():
            current_section = "summary"
            rest = line.split(":", 1)[-1].strip()
            if rest:
                summary += rest + " "
            continue

        if "NHIỆM VỤ:" in line.upper() or "NHIỆM VỤ :" in line.upper():
            current_section = "tasks"
            continue

        if current_section == "summary" and line:
            summary += line + " "

        if current_section == "tasks" and line.startswith("-"):
            task = line.lstrip("- ").strip()
            if task:
                tasks.append(task)

    return summary.strip(), tasks
