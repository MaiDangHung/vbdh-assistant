package com.vbdh.assistant.repository;

import com.vbdh.assistant.model.Task;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface TaskRepository extends JpaRepository<Task, Long> {
    List<Task> findByAnalysisId(Long analysisId);
    List<Task> findByStatus(String status);
}
