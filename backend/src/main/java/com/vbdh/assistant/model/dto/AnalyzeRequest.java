package com.vbdh.assistant.model.dto;

import lombok.Data;

import java.util.List;

/**
 * Request: Extension gửi nội dung văn bản + files về backend
 */
@Data
public class AnalyzeRequest {

    /** Trích yếu / tiêu đề */
    private String subject;

    /** Sổ văn bản */
    private String soVanBan;

    /** Số, ký hiệu VB */
    private String soKyHieu;

    /** Ngày ban hành */
    private String ngayBanHanh;

    /** Cơ quan ban hành */
    private String coQuanBanHanh;

    /** Loại văn bản */
    private String loaiVanBan;

    /** Người ký */
    private String nguoiKy;

    /** Nội dung body (trích yếu hoặc text từ file) */
    private String body;

    /** Danh sách file đính kèm (base64) */
    private List<FileInfo> files;

    /** Cache key từ extension */
    private String cacheKey;

    /** Bắt buộc xử lý lại */
    private boolean forceReprocess = false;

    @Data
    public static class FileInfo {
        private String name;
        private String mimeType;
        private String content;     // base64 encoded
        private long size;
        private String error;       // null nếu fetch OK
    }
}
