package com.vbdh.assistant.util;

import com.vbdh.assistant.model.Department;
import com.vbdh.assistant.model.dto.AnalyzeResponse;
import com.vbdh.assistant.repository.DepartmentRepository;
import lombok.RequiredArgsConstructor;
import lombok.extern.slf4j.Slf4j;
import org.springframework.stereotype.Component;

import java.text.Normalizer;
import java.util.*;
import java.util.regex.Pattern;
import java.util.stream.Collectors;

/**
 * Thuật toán gợi ý phòng ban (reuse từ tbkl-hoatien)
 */
@Slf4j
@Component
@RequiredArgsConstructor
public class DepartmentMatcher {

    private final DepartmentRepository departmentRepository;

    private static final Pattern DIACRITICS = Pattern.compile("\\p{InCombiningDiacriticalMarks}+");

    /**
     * Gợi ý phòng ban dựa trên nội dung văn bản
     */
    public List<AnalyzeResponse.DepartmentSuggestion> suggestDepartments(String text) {
        List<Department> departments = departmentRepository.findByActiveTrue();

        if (departments.isEmpty() || text == null || text.isBlank()) {
            return Collections.emptyList();
        }

        String normalizedText = normalize(text);

        List<AnalyzeResponse.DepartmentSuggestion> suggestions = departments.stream()
                .map(dept -> {
                    int score = calculateScore(normalizedText, dept);
                    return AnalyzeResponse.DepartmentSuggestion.builder()
                            .name(dept.getName())
                            .score(score)
                            .build();
                })
                .filter(s -> s.getScore() >= 30) // Threshold ≥30%
                .sorted(Comparator.comparingInt(AnalyzeResponse.DepartmentSuggestion::getScore).reversed())
                .limit(5) // Top 5
                .collect(Collectors.toList());

        log.info("Department suggestions: {}", suggestions.stream()
                .map(s -> s.getName() + "=" + s.getScore() + "%")
                .collect(Collectors.joining(", ")));

        return suggestions;
    }

    /**
     * Tính điểm matching
     */
    private int calculateScore(String normalizedText, Department department) {
        String normalizedName = normalize(department.getName());
        String alias = department.getAlias() != null ? normalize(department.getAlias()) : "";
        String keywords = department.getKeywords() != null ? normalize(department.getKeywords()) : "";

        int maxScore = 0;

        // Exact match: 100
        if (normalizedText.contains(normalizedName)) {
            maxScore = Math.max(maxScore, 100);
        }

        // Alias match: 100
        if (!alias.isBlank() && normalizedText.contains(alias)) {
            maxScore = Math.max(maxScore, 100);
        }

        // Keyword match: 80
        if (!keywords.isBlank()) {
            String[] keywordArr = keywords.split("[,;]");
            for (String kw : keywordArr) {
                String trimmed = kw.trim();
                if (!trimmed.isBlank() && normalizedText.contains(trimmed)) {
                    maxScore = Math.max(maxScore, 80);
                    break;
                }
            }
        }

        // Substring/word overlap: 0-60
        if (maxScore < 80) {
            Set<String> textWords = new HashSet<>(Arrays.asList(normalizedText.split("\\s+")));
            Set<String> deptWords = new HashSet<>(Arrays.asList(normalizedName.split("\\s+")));
            deptWords.addAll(Arrays.asList(alias.split("\\s+")));

            textWords.retainAll(deptWords);
            int overlap = textWords.size();
            int total = deptWords.size();
            if (total > 0 && overlap > 0) {
                maxScore = Math.max(maxScore, (int) ((double) overlap / total * 60));
            }
        }

        return maxScore;
    }

    /**
     * Normalize tiếng Việt (bỏ dấu, lowercase)
     */
    private String normalize(String input) {
        if (input == null) return "";
        String normalized = Normalizer.normalize(input.toLowerCase(), Normalizer.Form.NFD);
        return DIACRITICS.matcher(normalized).replaceAll("")
                .replaceAll("đ", "d")
                .replaceAll("[^a-z0-9\\s]", " ")
                .replaceAll("\\s+", " ")
                .trim();
    }
}
