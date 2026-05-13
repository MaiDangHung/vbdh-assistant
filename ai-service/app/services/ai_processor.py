"""AI Processor - Gọi AI model để xử lý văn bản"""

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
    """
    Gọi AI để xử lý văn bản
    """
    prompt = SUMMARY_PROMPT.format(text=text)

    result = await call_ai(prompt)

    # Parse response
    summary, task_list = parse_response(result)

    return {
        "summary": summary,
        "tasks": task_list,
        "raw_response": result,
    }


async def call_ai(prompt: str) -> str:
    """
    Gọi AI model qua OpenAI-compatible API
    """
    try:
        async with httpx.AsyncClient(timeout=120.0) as client:
            response = await client.post(
                f"{settings.ai_api_url}/chat/completions",
                headers={
                    "Authorization": f"Bearer {settings.ai_api_key}",
                    "Content-Type": "application/json",
                },
                json={
                    "model": settings.ai_model,
                    "messages": [
                        {"role": "system", "content": "Bạn là trợ lý xử lý văn bản điều hành của cơ quan nhà nước. Hãy trả lời bằng tiếng Việt."},
                        {"role": "user", "content": prompt},
                    ],
                    "temperature": 0.3,
                    "max_tokens": 2000,
                },
            )
            response.raise_for_status()
            data = response.json()
            return data["choices"][0]["message"]["content"]

    except httpx.HTTPError as e:
        logger.error(f"AI API error: {e}")
        raise Exception(f"Lỗi gọi AI service: {e}")


def parse_response(response: str) -> tuple:
    """
    Parse AI response thành summary và tasks
    """
    summary = ""
    tasks = []

    lines = response.split("\n")
    current_section = None

    for line in lines:
        line = line.strip()

        if "TÓM TẮT:" in line.upper() or "TÓM TẮT :" in line.upper():
            current_section = "summary"
            # Lấy phần còn lại của dòng sau "TÓM TẮT:"
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
