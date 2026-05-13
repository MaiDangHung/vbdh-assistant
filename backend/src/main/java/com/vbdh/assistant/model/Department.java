package com.vbdh.assistant.model;

import jakarta.persistence.*;
import lombok.AllArgsConstructor;
import lombok.Builder;
import lombok.Data;
import lombok.NoArgsConstructor;

/**
 * Danh sách phòng ban
 */
@Entity
@Table(name = "departments")
@Data
@Builder
@NoArgsConstructor
@AllArgsConstructor
public class Department {

    @Id
    @GeneratedValue(strategy = GenerationType.IDENTITY)
    private Long id;

    @Column(nullable = false, unique = true, length = 200)
    private String name;

    /** Tên viết tắt / alias */
    @Column(length = 100)
    private String alias;

    /** Từ khóa để matching */
    @Column(columnDefinition = "TEXT")
    private String keywords;

    @Column(name = "is_active")
    @Builder.Default
    private Boolean active = true;
}
