package com.vbdh.assistant.model.dto;

import lombok.Data;

import java.util.List;

/**
 * Request: Lưu nhiệm vụ đã xác nhận
 */
@Data
public class SaveTaskRequest {

    private String cacheKey;
    private List<TaskItem> tasks;

    @Data
    public static class TaskItem {
        private String description;
        private String assignedDepartment;
    }
}
