package com.vbdh.assistant.model.dto;

import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

import java.util.List;

/**
 * Response: Kết quả xử lý trả về cho Extension
 */
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class AnalyzeResponse {

    private String cacheKey;
    private String summary;
    private List<String> tasks;
    private List<DepartmentSuggestion> departments;
    private boolean fromCache;
    private long processingTimeMs;

    @Data
    @Builder
    @NoArgsConstructor
    @AllArgsConstructor
    public static class DepartmentSuggestion {
        private String name;
        private int score;
    }
}
