# VBDH Assistant

**Trợ lý xử lý văn bản điều hành từ Outlook**

Hệ thống hỗ trợ tổng hợp nội dung văn bản, trích xuất nhiệm vụ và gợi ý phân công phòng ban từ email Outlook Web.

## Kiến trúc

```
Outlook Web (Browser)
    │
    ├── Chrome Extension (Manifest V3)
    │   ├── Content Script: Thu thập nội dung email + file đính kèm
    │   └── Popup: Hiển thị kết quả tóm tắt, nhiệm vụ, phòng ban
    │
    ▼
Backend API (Spring Boot)
    ├── Kiểm tra cache (tránh xử lý trùng)
    ├── Nhận & xử lý file đính kèm
    └── Gọi AI Service
    │
    ▼
AI Service (Python FastAPI)
    ├── Trích xuất text (PDF, DOCX)
    ├── OCR (file scan)
    ├── Tóm tắt nội dung
    ├── Trích xuất nhiệm vụ
    └── Gợi ý phòng ban
```

## Cài đặt

```bash
# Clone
git clone git@github.com:MaiDangHung/vbdh-assistant.git

# Chạy toàn bộ services
docker-compose up -d
```

## Cấu trúc thư mục

```
vbdh-assistant/
├── extension/          # Chrome Extension
├── backend/            # Spring Boot API
├── ai-service/         # Python FastAPI
├── docker-compose.yml
└── README.md
```

## Tech Stack

| Thành phần | Công nghệ |
|-----------|-----------|
| Extension | Chrome Manifest V3, TypeScript |
| Backend | Java 17, Spring Boot 3.3, PostgreSQL |
| AI Service | Python 3.12, FastAPI |
| Database | PostgreSQL |
| File Storage | MinIO |
```
