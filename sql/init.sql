CREATE DATABASE IF NOT EXISTS rpc_trace DEFAULT CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;

USE rpc_trace;

CREATE TABLE IF NOT EXISTS traces (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL UNIQUE COMMENT '链路追踪ID',
    total_duration INT NOT NULL DEFAULT 0 COMMENT '总耗时(ms)',
    status VARCHAR(16) NOT NULL DEFAULT 'success' COMMENT '状态: success/error',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_trace_id (trace_id),
    INDEX idx_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='调用链路主表';

CREATE TABLE IF NOT EXISTS spans (
    id BIGINT AUTO_INCREMENT PRIMARY KEY,
    trace_id VARCHAR(64) NOT NULL COMMENT '链路追踪ID',
    span_id VARCHAR(64) NOT NULL COMMENT 'Span ID',
    parent_span_id VARCHAR(64) NULL COMMENT '父Span ID',
    service_name VARCHAR(64) NOT NULL COMMENT '服务名称',
    operation_name VARCHAR(128) NOT NULL COMMENT '操作名称',
    start_time BIGINT NOT NULL COMMENT '开始时间(ms时间戳)',
    end_time BIGINT NOT NULL COMMENT '结束时间(ms时间戳)',
    duration INT NOT NULL COMMENT '耗时(ms)',
    depth INT NOT NULL DEFAULT 0 COMMENT '调用深度(0为根节点)',
    status VARCHAR(16) NOT NULL DEFAULT 'success' COMMENT '状态: success/error',
    request_data TEXT NULL COMMENT '请求数据(JSON)',
    response_data TEXT NULL COMMENT '响应数据(JSON)',
    created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    INDEX idx_trace_id (trace_id),
    INDEX idx_span_id (span_id),
    INDEX idx_parent_span_id (parent_span_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COMMENT='调用链路Span表';
