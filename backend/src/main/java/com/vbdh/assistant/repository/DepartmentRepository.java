package com.vbdh.assistant.repository;

import com.vbdh.assistant.model.Department;
import org.springframework.data.jpa.repository.JpaRepository;

import java.util.List;

public interface DepartmentRepository extends JpaRepository<Department, Long> {
    List<Department> findByActiveTrue();
}
