package com.vbdh.assistant.controller;

import com.vbdh.assistant.model.dto.AnalyzeRequest;
import com.vbdh.assistant.model.dto.AnalyzeResponse;
import com.vbdh.assistant.model.dto.SaveTaskRequest;
import com.vbdh.assistant.service.AnalysisService;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.http.ResponseEntity;
import org.springframework.web.bind.annotation.*;

import java.util.Map;

@Slf4j
@RestController
@RequestMapping("/api/v1")
@RequiredArgsConstructor
public class EmailController {

    private final AnalysisService analysisService;

    /**
     * POST /api/v1/email/analyze
     * Nhận nội dung email từ Extension → check cache → xử lý AI → trả kết quả
     */
    @PostMapping("/email/analyze")
    public ResponseEntity<AnalyzeResponse> analyzeEmail(@RequestBody AnalyzeRequest request) {
        log.info("Analyze request: subject='{}', forceReprocess={}", request.getSubject(), request.isForceReprocess());
        AnalyzeResponse response = analysisService.analyze(request);
        return ResponseEntity.ok(response);
    }

    /**
     * POST /api/v1/task/save
     * Lưu nhiệm vụ đã xác nhận
     */
    @PostMapping("/task/save")
    public ResponseEntity<Map<String, Object>> saveTasks(@RequestBody SaveTaskRequest request) {
        log.info("Save tasks: cacheKey={}, tasks={}", request.getCacheKey(),
                request.getTasks() != null ? request.getTasks().size() : 0);

        // TODO: Implement task saving logic
        return ResponseEntity.ok(Map.of(
                "success", true,
                "message", "Đã lưu nhiệm vụ"
        ));
    }

    /**
     * GET /api/v1/health
     * Health check
     */
    @GetMapping("/health")
    public ResponseEntity<Map<String, Object>> health() {
        return ResponseEntity.ok(Map.of(
                "status", "UP",
                "service", "vbdh-assistant"
        ));
    }
}
