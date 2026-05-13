# Chrome Extension - VBDH Assistant

## Cài đặt cho development

1. Mở Chrome → `chrome://extensions/`
2. Bật "Developer mode" (góc phải trên)
3. Click "Load unpacked" → chọn thư mục `extension/`

## Cấu trúc

```
extension/
├── manifest.json          # Manifest V3 config
├── src/
│   ├── popup/
│   │   ├── popup.html     # Giao diện popup
│   │   ├── popup.css      # Style
│   │   └── popup.ts       # Logic popup
│   ├── content/
│   │   └── content.ts     # Content script - đọc Outlook DOM
│   └── background/
│       └── background.ts  # Service worker
├── icons/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── dist/                  # Build output
```

## Build

```bash
npm install
npm run build
```

## Cách hoạt động

1. User mở email trên Outlook Web
2. Click Extension icon
3. Content Script thu thập: subject, body, sender, attachments
4. Gửi về Backend API → AI xử lý
5. Popup hiển thị: tóm tắt, nhiệm vụ, phòng ban đề xuất
6. Cache kết quả theo email key
