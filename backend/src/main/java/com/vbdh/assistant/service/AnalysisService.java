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
     * Xử lý văn bản: check cache → AI xử lý → lưu kết quả
     *
     * PERFORMANCE: Cache-first, chỉ gọi AI khi cần thiết
     * SECURITY: SHA256 hash cache key
     */
    public AnalyzeResponse analyze(AnalyzeRequest request) {
        long startTime = System.currentTimeMillis();

        // Tạo SHA256 cache key
        String cacheKey = request.getCacheKey() != null
                ? sha256(request.getCacheKey())
                : sha256(generateCacheKey(request));

        log.info("Analyze: soKyHieu='{}', coQuanBanHanh='{}', cacheKey={}, files={}",
                request.getSoKyHieu(), request.getCoQuanBanHanh(), cacheKey,
                request.getFiles() != null ? request.getFiles().size() : 0);

        // ============ CHECK CACHE TRƯỚC ============
        if (!request.isForceReprocess()) {
            var cached = analysisRepository.findByCacheKey(cacheKey);
            if (cached.isPresent()) {
                EmailAnalysis existing = cached.get();
                log.info("Cache HIT: key={}, age={}ms", cacheKey,
                        System.currentTimeMillis() - existing.getCreatedAt().getNano() / 1_000_000);
                return buildResponse(existing, true, System.currentTimeMillis() - startTime);
            }
        } else {
            // Force reprocess - xóa cache cũ
            analysisRepository.findByCacheKey(cacheKey).ifPresent(existing -> {
                analysisRepository.delete(existing);
                log.info("Cache CLEARED: key={}", cacheKey);
            });
        }

        // ============ XỬ LÝ MỚI ============

        // 1. Chuẩn bị text để gửi AI
        String combinedText = buildCombinedText(request);

        // 2. Gọi AI Service (summarize + extract tasks)
        AiServiceClient.AiResult aiResult = aiServiceClient.analyze(combinedText);

        // 3. Gợi ý phòng ban
        List<AnalyzeResponse.DepartmentSuggestion> deptSuggestions =
                departmentMatcher.suggestDepartments(combinedText);

        // 4. Lưu vào cache
        long processingTime = System.currentTimeMillis() - startTime;

        EmailAnalysis analysis = EmailAnalysis.builder()
                .cacheKey(cacheKey)
                .subject(request.getSubject())
                .sender(request.getCoQuanBanHanh())
                .sentDate(request.getNgayBanHanh())
                .emailBody(truncate(request.getBody(), 5000))
                .attachmentNames(request.getFiles() != null
                        ? request.getFiles().stream()
                        .map(AnalyzeRequest.FileInfo::getName)
                        .collect(Collectors.joining(","))
                        : "")
                .summary(aiResult.getSummary())
                .tasks(toJson(aiResult.getTasks()))
                .departments(toJsonDept(deptSuggestions))
                .processingTimeMs(processingTime)
                .build();

        analysisRepository.save(analysis);
        log.info("SAVED analysis: key={}, time={}ms, tasks={}", cacheKey, processingTime, aiResult.getTasks().size());

        return AnalyzeResponse.builder()
                .cacheKey(cacheKey)
                .summary(aiResult.getSummary())
                .tasks(aiResult.getTasks())
                .departments(deptSuggestions)
                .fromCache(false)
                .processingTimeMs(processingTime)
                .build();
    }

    /**
     * Kết hợp text: trích yếu + thông tin metadata
     */
    private String buildCombinedText(AnalyzeRequest request) {
        StringBuilder sb = new StringBuilder();

        if (request.getSoKyHieu() != null && !request.getSoKyHieu().isBlank()) {
            sb.append("Số hiệu: ").append(request.getSoKyHieu()).append("\n");
        }
        if (request.getCoQuanBanHanh() != null && !request.getCoQuanBanHanh().isBlank()) {
            sb.append("Cơ quan ban hành: ").append(request.getCoQuanBanHanh()).append("\n");
        }
        if (request.getLoaiVanBan() != null && !request.getLoaiVanBan().isBlank()) {
            sb.append("Loại văn bản: ").append(request.getLoaiVanBan()).append("\n");
        }
        if (request.getNgayBanHanh() != null && !request.getNgayBanHanh().isBlank()) {
            sb.append("Ngày ban hành: ").append(request.getNgayBanHanh()).append("\n");
        }

        sb.append("\n");

        if (request.getBody() != null && !request.getBody().isBlank()) {
            sb.append("Nội dung:\n").append(request.getBody());
        }

        return sb.toString();
    }

    private String generateCacheKey(AnalyzeRequest request) {
        StringBuilder sb = new StringBuilder();
        sb.append(request.getSoKyHieu()).append("|||");
        sb.append(request.getNgayBanHanh()).append("|||");
        sb.append(request.getCoQuanBanHanh()).append("|||");
        if (request.getFiles() != null) {
            sb.append(request.getFiles().stream()
                    .map(AnalyzeRequest.FileInfo::getName)
                    .sorted()
                    .collect(Collectors.joining(",")));
        }
        return sb.toString();
    }

    private String sha256(String input) {
        try {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] hash = digest.digest(input.getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(hash);
        } catch (Exception e) {
            throw new RuntimeException("SHA-256 not available", e);
        }
    }

    private String truncate(String s, int max) {
        if (s == null) return "";
        return s.length() > max ? s.substring(0, max) + "..." : s;
    }

    private String toJson(Object obj) {
        try {
            return objectMapper.writeValueAsString(obj);
        } catch (JsonProcessingException e) {
            return "[]";
        }
    }

    private String toJsonDept(List<AnalyzeResponse.DepartmentSuggestion> depts) {
        try {
            List<Object[]> simplified = depts.stream()
                    .map(d -> new Object[]{d.getName(), d.getScore()})
                    .collect(Collectors.toList());
            return objectMapper.writeValueAsString(simplified);
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
        List<List<Object>> raw = objectMapper.readValue(json, new TypeReference<>() {});
        return raw.stream()
                .map(arr -> AnalyzeResponse.DepartmentSuggestion.builder()
                        .name((String) arr.get(0))
                        .score(((Number) arr.get(1)).intValue())
                        .build())
                .collect(Collectors.toList());
    }
}
