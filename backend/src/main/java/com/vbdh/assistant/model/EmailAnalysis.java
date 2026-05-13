package com.vbdh.assistant.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.time.LocalDateTime;
import java.util.List;

/**
 * Cache & lưu trữ kết quả xử lý văn bản
 */
@Entity
@Table(name = "email_analysis")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class EmailAnalysis {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    /** Cache key - SHA256 hash */
    @Column(nullable = false, unique = true, length = 64)
    private String cacheKey;

    /** Thông tin email gốc */
    @Column(length = 500)
    private String subject;

    @Column(length = 200)
    private String sender;

    @Column(length = 100)
    private String sentDate;

    @Column(columnDefinition = "TEXT")
    private String emailBody;

    /** File đính kèm - JSON array of filenames */
    @Column(columnDefinition = "TEXT")
    private String attachmentNames;

    /** Kết quả xử lý */
    @Column(columnDefinition = "TEXT")
    private String summary;

    @Column(columnDefinition = "TEXT")
    private String tasks; // JSON array

    @Column(columnDefinition = "TEXT")
    private String departments; // JSON array with scores

    /** Trạng thái */
    @Enumerated(EnumType.STRING)
    @Column(length = 20)
    private AnalysisStatus status;

    /** Metadata */
    @Column(name = "from_cache")
    private Boolean fromCache;

    @Column(name = "processing_time_ms")
    private Long processingTimeMs;

    @Column(name = "created_at", updatable = false)
    private LocalDateTime createdAt;

    @Column(name = "updated_at")
    private LocalDateTime updatedAt;

    @PrePersist
    protected void onCreate() {
        createdAt = LocalDateTime.now();
        updatedAt = LocalDateTime.now();
        if (status == null) status = AnalysisStatus.PROCESSED;
        if (fromCache == null) fromCache = false;
    }

    @PreUpdate
    protected void onUpdate() {
        updatedAt = LocalDateTime.now();
    }

    public enum AnalysisStatus {
        PROCESSING,
        PROCESSED,
        ERROR
    }
}
