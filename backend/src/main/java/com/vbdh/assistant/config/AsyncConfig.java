package com.vbdh.assistant.config;

import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.scheduling.annotation.EnableAsync;
import org.springframework.scheduling.concurrent.ThreadPoolTaskExecutor;

import java.util.concurrent.Executor;

/**
 * Async configuration cho queue xử lý
 */
@Configuration
@EnableAsync
public class AsyncConfig {

    /**
     * Thread pool cho xử lý AI - tối đa 2 thread đồng thời
     * để không overload AI service
     */
    @Bean(name = "analysisExecutor")
    public Executor analysisExecutor() {
        ThreadPoolTaskExecutor executor = new ThreadPoolTaskExecutor();
        executor.setCorePoolSize(1);
        executor.setMaxPoolSize(2);
        executor.setQueueCapacity(50);
        executor.setThreadNamePrefix("vbdh-analysis-");
        executor.setRejectedExecutionHandler((r, e) -> {
            throw new RuntimeException("Hàng đợi xử lý đang đầy. Vui lòng thử lại sau.");
        });
        executor.initialize();
        return executor;
    }
}
