package com.vbdh.assistant.model.dto;

import lombok.Data;

import java.util.List;

/**
 * Request: Extension gửi nội dung email về backend
 */
@Data
public class AnalyzeRequest {

    private String subject;
    private String sender;
    private String sentDate;
    private String body;

    /** Danh sách file đính kèm */
    private List<AttachmentInfo> attachments;

    /** Cache key (từ content script) */
    private String cacheKey;

    /** Bắt buộc xử lý lại (bỏ qua cache) */
    private boolean forceReprocess = false;

    @Data
    public static class AttachmentInfo {
        private String name;
        private String downloadUrl;
        private String base64Content; // Filled by extension or backend
    }
}
