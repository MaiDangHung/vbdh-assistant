# VBDH Assistant

**Trợ lý xử lý văn bản điều hành từ hệ thống QLVBDH**

Chrome Extension đọc văn bản từ hệ thống QLVBDH, gọi API của hệ thống [tbkl-hoatien](https://github.com/MaiDangHung/tbkl-banhanh) để xử lý AI (tóm tắt, trích xuất nhiệm vụ, gợi ý phòng ban).

## Kiến trúc

```
Hệ thống QLVBDH (qlvbdh.danang.gov.vn)
    │
    │ Extension đọc React state + fetch files
    ▼
Chrome Extension (Manifest V3)
    │
    │ API Key authentication
    ▼
tbkl-hoatien Backend API
    ├── POST /api/v1/ext/documents/upload     → Upload file
    ├── POST /api/v1/ext/documents/{id}/extract → Trích xuất AI
    ├── GET  /api/v1/ext/documents/{id}/result  → Lấy kết quả (cache)
    └── POST /api/v1/ext/documents/{id}/re-extract → Xử lý lại
```

## Cài đặt

### 1. Cài Extension
```bash
# Clone
git clone git@github.com:MaiDangHung/vbdh-assistant.git

# Cài lên Chrome
1. Mở chrome://extensions/
2. Bật "Chế độ dành cho nhà phát triển"
3. Click "Tải tiện ích đã giải nén" → chọn thư mục extension/
```

### 2. Cấu hình
- Mở `extension/popup.js` → chỉnh `TBKL_API_BASE` nếu cần
- API Key mặc định: `vbdh-ext-sk-2026-hoatien-secure`

## Sử dụng

1. Mở https://qlvbdh.danang.gov.vn → đăng nhập
2. Click vào 1 văn bản → chi tiết xổ ra
3. Click Extension icon → Xem tóm tắt + nhiệm vụ + phòng ban
4. Click "Lưu" hoặc "Xử lý lại"

## Tech Stack

| Thành phần | Công nghệ |
|-----------|-----------|
| Extension | Chrome Manifest V3, Vanilla JS |
| API Backend | tbkl-hoatien (Spring Boot) |
| AI | GLM model (qua tbkl-hoatien AI Service) |
