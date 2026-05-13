package com.vbdh.assistant.service;

import lombok.Data;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Service;
import org.springframework.web.reactive.function.client.WebClient;

import java.util.List;
import java.util.Map;

/**
 * Client gọi AI Service (Python FastAPI)
 */
@Slf4j
@Service
@RequiredArgsConstructor
public class AiServiceClient {

    private final WebClient.Builder webClientBuilder;

    @Value("${ai-service.url}")
    private String aiServiceUrl;

    @Value("${ai-service.timeout}")
    private int timeout;

    /**
     * Gọi AI để tóm tắt + trích xuất nhiệm vụ
     */
    public AiResult analyze(String text) {
        log.info("Calling AI service at {} for text length={}", aiServiceUrl, text.length());

        WebClient webClient = webClientBuilder.build();

        Map<String, Object> requestBody = Map.of(
                "text", text,
                "tasks", List.of("summarize", "extract_tasks")
        );

        @SuppressWarnings("unchecked")
        Map<String, Object> response = webClient.post()
                .uri(aiServiceUrl + "/analyze")
                .bodyValue(requestBody)
                .retrieve()
                .bodyToMono(Map.class)
                .block(java.time.Duration.ofSeconds(timeout));

        if (response == null) {
            throw new RuntimeException("AI service returned null response");
        }

        AiResult result = new AiResult();
        result.setSummary((String) response.get("summary"));

        @SuppressWarnings("unchecked")
        List<String> tasks = (List<String>) response.get("tasks");
        result.setTasks(tasks != null ? tasks : List.of());

        log.info("AI result: summary length={}, tasks count={}",
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
