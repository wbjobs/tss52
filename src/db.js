const mysql = require('mysql2/promise');
require('dotenv').config();

const pool = mysql.createPool({
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '3306'),
  user: process.env.DB_USER || 'root',
  password: process.env.DB_PASSWORD || '',
  database: process.env.DB_NAME || 'rpc_trace',
  waitForConnections: true,
  connectionLimit: 10,
  queueLimit: 0,
  timezone: '+08:00'
});

async function initTables() {
  const sql = `
    CREATE TABLE IF NOT EXISTS traces (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      trace_id VARCHAR(64) NOT NULL UNIQUE,
      total_duration INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'success',
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_trace_id (trace_id),
      INDEX idx_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

    CREATE TABLE IF NOT EXISTS spans (
      id BIGINT AUTO_INCREMENT PRIMARY KEY,
      trace_id VARCHAR(64) NOT NULL,
      span_id VARCHAR(64) NOT NULL,
      parent_span_id VARCHAR(64) NULL,
      service_name VARCHAR(64) NOT NULL,
      operation_name VARCHAR(128) NOT NULL,
      start_time BIGINT NOT NULL,
      end_time BIGINT NOT NULL,
      duration INT NOT NULL,
      depth INT NOT NULL DEFAULT 0,
      status VARCHAR(16) NOT NULL DEFAULT 'success',
      request_data TEXT NULL,
      response_data TEXT NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX idx_trace_id (trace_id),
      INDEX idx_span_id (span_id),
      INDEX idx_parent_span_id (parent_span_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
  `;
  
  try {
    const statements = sql.split(';').filter(s => s.trim());
    for (const stmt of statements) {
      await pool.execute(stmt);
    }
    console.log('[DB] 数据库表初始化完成');
  } catch (err) {
    console.error('[DB] 表初始化失败:', err.message);
  }
}

module.exports = { pool, initTables };
