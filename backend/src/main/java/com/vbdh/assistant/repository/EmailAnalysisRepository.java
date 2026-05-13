package com.vbdh.assistant.repository;

import com.vbdh.assistant.model.EmailAnalysis;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.Optional;

public interface EmailAnalysisRepository extends JpaRepository<EmailAnalysis, Long> {
    Optional<EmailAnalysis> findByCacheKey(String cacheKey);
    void deleteByCacheKey(String cacheKey);
}
