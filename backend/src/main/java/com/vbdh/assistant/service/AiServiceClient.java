package com.vbdh.assistant.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.time.Duration;
import java.util.List;
import java.util.Map;

/**
 * Client gọi AI Service
 * 
 * PERFORMANCE: 
 * - Timeout 120 giây
 * - Retry 1 lần nếu lỗi (không spam)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiServiceClient {

    private final WebClient.Builder webClientBuilder;

    @Value("${ai-service.url}")
    private String aiServiceUrl;

    @Value("${ai-service.timeout:120}")
    private int timeout;

    @Value("${ai-service.max-retries:1}")
    private int maxRetries;

    /**
     * Gọi AI để tóm tắt + trích xuất nhiệm vụ
     * Retry tối đa maxRetries lần
     */
    public AiResult analyze(String text) {
        Exception lastError = null;

        for (int attempt = 0; attempt <= maxRetries; attempt++) {
            try {
                if (attempt > 0) {
                    // Backoff: 2s, 4s, 8s...
                    long backoff = (long) Math.pow(2, attempt) * 1000;
                    log.info("Retry attempt {} after {}ms", attempt, backoff);
                    Thread.sleep(backoff);
                }

                return doAnalyze(text);
            } catch (Exception e) {
                lastError = e;
                log.warn("AI call failed (attempt {}/{}): {}", attempt + 1, maxRetries + 1, e.getMessage());
            }
        }

        throw new RuntimeException("AI service không khả dụng sau " + (maxRetries + 1) + " lần thử: " + lastError.getMessage());
    }

    private AiResult doAnalyze(String text) {
        log.info("Calling AI service: text_length={}", text.length());

        WebClient webClient = webClientBuilder.build();

        Map<String, Object> requestBody = Map.of(
                "text", text,
                "tasks", List.of("summarize", "extract_tasks")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> response = webClient.post()
                .uri(aiServiceUrl + "/api/v1/analyze")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Map.class)
                .block(Duration.ofSeconds(timeout));

        if (response == null) {
            throw new RuntimeException("AI service returned null");
        }

        AiResult result = new AiResult();
        result.setSummary((String) response.get("summary"));

        @SuppressWarnings("unchecked")
        List<String> tasks = (List<String>) response.get("tasks");
        result.setTasks(tasks != null ? tasks : List.of());

        log.info("AI result: summary_len={}, tasks_count={}",
                result.getSummary() != null ? result.getSummary().length() : 0,
                result.getTasks().size());

        return result;
    }

    @Data
    public static class AiResult {
        private String summary;
        private List<String> tasks;
    }
}
