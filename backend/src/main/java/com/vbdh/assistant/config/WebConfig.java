package com.vbdh.assistant.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.web.cors.CorsConfiguration;
import org.springframework.web.cors.UrlBasedCorsConfigurationSource;
import org.springframework.web.filter.CorsFilter;

import java.util.List;

/**
 * CORS Configuration
 * 
 * Cho phép request từ:
 * 1. Content Script (chạy trên qlvbdh.danang.gov.vn → gọi Backend)
 * 2. Extension Popup (chrome-extension://xxx → gọi Backend)
 * 3. Frontend Dashboard (nếu có)
 */
@Configuration
public class WebConfig {

    @Bean
    public CorsFilter corsFilter() {
        CorsConfiguration config = new CorsConfiguration();

        // Origins được phép gọi API
        config.setAllowedOriginPatterns(List.of(
                "chrome-extension://*",              // Extension popup
                "https://qlvbdh.danang.gov.vn",     // Content script
                "http://localhost:*",                 // Dev
                "https://localhost:*",                // Dev HTTPS
                "http://10.10.68.55:*"                // Internal network
        ));

        config.setAllowedMethods(List.of("GET", "POST", "PUT", "DELETE", "OPTIONS"));
        config.setAllowedHeaders(List.of("*"));
        config.setAllowCredentials(false);
        config.setMaxAge(3600L);

        UrlBasedCorsConfigurationSource source = new UrlBasedCorsConfigurationSource();
        source.registerCorsConfiguration("/api/**", config);
        return new CorsFilter(source);
    }
}
