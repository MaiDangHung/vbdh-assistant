package com.vbdh.assistant.service;

import com.vbdh.assistant.model.EmailAnalysis;
import com.vbdh.assistant.model.dto.AnalyzeRequest;
import com.vbdh.assistant.model.dto.AnalyzeResponse;
import com.vbdh.assistant.repository.EmailAnalysisRepository;
import com.vbdh.assistant.util.DepartmentMatcher;
import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Service;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.HexFormat;
import java.util.List;
import java.util.stream.Collectors;

@Slf4j
@Service
@RequiredArgsConstructor
public class AnalysisService {

    private final EmailAnalysisRepository analysisRepository;
    private final AiServiceClient aiServiceClient;
    private final DepartmentMatcher departmentMatcher;
    private final ObjectMapper objectMapper;

    /**
     * Xử lý email: check cache → AI xử lý → lưu kết quả
     */
    public AnalyzeResponse analyze(AnalyzeRequest request) {
        long startTime = System.currentTimeMillis();

        // Tạo cache key nếu chưa có
        String cacheKey = request.getCacheKey() != null
                ? request.getCacheKey()
                : generateCacheKey(request);

        // Tạo SHA256 hash cho cache key
        String hashedKey = sha256(cacheKey);

        log.info("Analyzing email: subject='{}', cacheKey={}", request.getSubject(), hashedKey);

        // CHECK CACHE trước khi xử lý
        if (!request.isForceReprocess()) {
            var cached = analysisRepository.findByCacheKey(hashedKey);
            if (cached.isPresent()) {
                EmailAnalysis existing = cached.get();
                log.info("Cache hit for key={}, processingTimeMs={}", hashedKey, existing.getProcessingTimeMs());
                return buildResponse(existing, true, System.currentTimeMillis() - startTime);
            }
        } else {
            // Force reprocess - xóa cache cũ
            analysisRepository.findByCacheKey(hashedKey).ifPresent(existing -> {
                analysisRepository.delete(existing);
                log.info("Deleted old cache for key={}", hashedKey);
            });
        }

        // XỬ LÝ MỚI
        // 1. Gọi AI Service để tóm tắt + trích xuất nhiệm vụ
        String combinedText = buildCombinedText(request);
        AiServiceClient.AiResult aiResult = aiServiceClient.analyze(combinedText);

        // 2. Gợi ý phòng ban
        List<AnalyzeResponse.DepartmentSuggestion> deptSuggestions =
                departmentMatcher.suggestDepartments(combinedText);

        // 3. Lưu vào database (cache)
        long processingTime = System.currentTimeMillis() - startTime;

        EmailAnalysis analysis = EmailAnalysis.builder()
                .cacheKey(hashedKey)
                .subject(request.getSubject())
                .sender(request.getSender())
                .sentDate(request.getSentDate())
                .emailBody(request.getBody())
                .summary(aiResult.getSummary())
                .tasks(toJson(aiResult.getTasks()))
                .departments(toJson(deptSuggestions.stream()
                        .map(d -> new java.util.AbstractMap.SimpleEntry<>(d.getName(), d.getScore()))
                        .collect(Collectors.toList())))
                .processingTimeMs(processingTime)
                .build();

        analysisRepository.save(analysis);
        log.info("Saved analysis: key={}, processingTimeMs={}", hashedKey, processingTime);

        return AnalyzeResponse.builder()
                .cacheKey(hashedKey)
                .summary(aiResult.getSummary())
                .tasks(aiResult.getTasks())
                .departments(deptSuggestions)
                .fromCache(false)
                .processingTimeMs(processingTime)
                .build();
    }

    /**
     * Tạo cache key từ thông tin email
     */
    private String generateCacheKey(AnalyzeRequest request) {
        StringBuilder sb = new StringBuilder();
        sb.append(request.getSubject()).append("|||");
        sb.append(request.getSender()).append("|||");
        sb.append(request.getSentDate()).append("|||");
        if (request.getAttachments() != null) {
            sb.append(request.getAttachments().stream()
                    .map(AnalyzeRequest.AttachmentInfo::getName)
                    .sorted()
                    .collect(Collectors.joining(",")));
        }
        return sb.toString();
    }

    /**
     * SHA256 hash
     */
    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (NoSuchAlgorithmException e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    /**
     * Kết hợp text từ email body + subject
     */
    private String buildCombinedText(AnalyzeRequest request) {
        StringBuilder sb = new StringBuilder();
        if (request.getSubject() != null && !request.getSubject().isBlank()) {
            sb.append("Tiêu đề: ").append(request.getSubject()).append("\n\n");
        }
        if (request.getBody() != null && !request.getBody().isBlank()) {
            sb.append("Nội dung:\n").append(request.getBody());
        }
        return sb.toString();
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    private AnalyzeResponse buildResponse(EmailAnalysis existing, boolean fromCache, long processingTimeMs) {
        try {
            List<String> tasks = objectMapper.readValue(existing.getTasks(), new TypeReference<>() {});
            List<AnalyzeResponse.DepartmentSuggestion> depts = parseDepartments(existing.getDepartments());
            return AnalyzeResponse.builder()
                    .cacheKey(existing.getCacheKey())
                    .summary(existing.getSummary())
                    .tasks(tasks)
                    .departments(depts)
                    .fromCache(fromCache)
                    .processingTimeMs(processingTimeMs)
                    .build();
        } catch (JsonProcessingException e) {
            throw new RuntimeException("Failed to parse cached result", e);
        }
    }

    private List<AnalyzeResponse.DepartmentSuggestion> parseDepartments(String json) throws JsonProcessingException {
        List<java.util.AbstractMap.SimpleEntry<String, Integer>> raw =
                objectMapper.readValue(json, new TypeReference<>() {});
        return raw.stream()
                .map(e -> AnalyzeResponse.DepartmentSuggestion.builder()
                        .name(e.getKey())
                        .score(e.getValue())
                        .build())
                .collect(Collectors.toList());
    }
}
