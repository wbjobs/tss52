const { pool } = require('../db');

let idCounter = 0;
function generateId() {
  const counter = (++idCounter).toString(36);
  return Date.now().toString(36) + counter + Math.random().toString(36).substring(2, 8);
}

function validateSpanHierarchy(traceId, spans) {
  const spanIds = new Set(spans.map(s => s.spanId));
  const errors = [];
  
  for (const span of spans) {
    if (span.parentSpanId !== null && span.parentSpanId !== undefined) {
      if (!spanIds.has(span.parentSpanId)) {
        errors.push(
          `Span ${span.spanId} (${span.serviceName}.${span.operationName}) ` +
          `的 parentSpanId=${span.parentSpanId} 在本 trace=${traceId} 中不存在`
        );
      }
    }
  }
  
  if (errors.length > 0) {
    console.error(`[HierarchyCheck] trace=${traceId} 父子关系校验失败:`, errors);
    return false;
  }
  return true;
}

async function createTrace(traceId, totalDuration, status = 'success') {
  const [result] = await pool.execute(
    'INSERT INTO traces (trace_id, total_duration, status) VALUES (?, ?, ?)',
    [traceId, totalDuration, status]
  );
  return result.insertId;
}

async function updateTrace(traceId, totalDuration, status) {
  await pool.execute(
    'UPDATE traces SET total_duration = ?, status = ? WHERE trace_id = ?',
    [totalDuration, status, traceId]
  );
}

async function createSpan(span) {
  const [result] = await pool.execute(
    `INSERT INTO spans 
     (trace_id, span_id, parent_span_id, service_name, operation_name, 
      start_time, end_time, duration, depth, status, request_data, response_data)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    [
      span.traceId,
      span.spanId,
      span.parentSpanId || null,
      span.serviceName,
      span.operationName,
      span.startTime,
      span.endTime,
      span.duration,
      span.depth,
      span.status,
      span.requestData || null,
      span.responseData || null
    ]
  );
  return result.insertId;
}

async function getTrace(traceId) {
  const [rows] = await pool.execute(
    'SELECT * FROM traces WHERE trace_id = ?',
    [traceId]
  );
  return rows[0] || null;
}

async function getSpansByTraceId(traceId) {
  const [rows] = await pool.execute(
    'SELECT * FROM spans WHERE trace_id = ? ORDER BY start_time ASC, depth ASC',
    [traceId]
  );
  return rows;
}

async function getTraceWithSpans(traceId) {
  const trace = await getTrace(traceId);
  if (!trace) return null;
  
  const spans = await getSpansByTraceId(traceId);
  
  const spanMap = {};
  spans.forEach(s => {
    spanMap[s.span_id] = {
      ...s,
      children: []
    };
  });
  
  const roots = [];
  spans.forEach(s => {
    if (s.parent_span_id && spanMap[s.parent_span_id]) {
      spanMap[s.parent_span_id].children.push(spanMap[s.span_id]);
    } else {
      roots.push(spanMap[s.span_id]);
    }
  });
  
  return {
    trace: trace,
    spans: spans.map(s => ({
      id: s.id,
      traceId: s.trace_id,
      spanId: s.span_id,
      parentSpanId: s.parent_span_id,
      serviceName: s.service_name,
      operationName: s.operation_name,
      startTime: s.start_time,
      endTime: s.end_time,
      duration: s.duration,
      depth: s.depth,
      status: s.status,
      requestData: s.request_data ? JSON.parse(s.request_data) : null,
      responseData: s.response_data ? JSON.parse(s.response_data) : null,
      createdAt: s.created_at
    })),
    tree: roots
  };
}

async function listTraces(page = 1, pageSize = 20) {
  const offset = (page - 1) * pageSize;
  const [rows] = await pool.execute(
    'SELECT * FROM traces ORDER BY created_at DESC LIMIT ? OFFSET ?',
    [pageSize, offset]
  );
  const [countRow] = await pool.execute('SELECT COUNT(*) as total FROM traces');
  return {
    list: rows,
    total: countRow[0].total,
    page,
    pageSize
  };
}

async function createTraceWithSpansTransaction(traceId, totalDuration, status, spans) {
  if (!validateSpanHierarchy(traceId, spans)) {
    throw new Error(`trace=${traceId} 调用链父子关系校验失败，数据已损坏`);
  }
  
  const connection = await pool.getConnection();
  
  try {
    await connection.beginTransaction();
    
    await connection.execute(
      'INSERT INTO traces (trace_id, total_duration, status) VALUES (?, ?, ?)',
      [traceId, totalDuration, status]
    );
    
    if (spans.length > 0) {
      const values = spans.map(s => [
        s.traceId,
        s.spanId,
        s.parentSpanId || null,
        s.serviceName,
        s.operationName,
        s.startTime,
        s.endTime,
        s.duration,
        s.depth,
        s.status,
        s.requestData || null,
        s.responseData || null
      ]);
      
      const placeholders = spans.map(() => '(?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)').join(', ');
      const flatValues = values.flat();
      
      await connection.execute(
        `INSERT INTO spans 
         (trace_id, span_id, parent_span_id, service_name, operation_name, 
          start_time, end_time, duration, depth, status, request_data, response_data)
         VALUES ${placeholders}`,
        flatValues
      );
    }
    
    await connection.commit();
    console.log(`[DB] trace=${traceId} 事务提交成功，共 ${spans.length} 个 spans`);
    
  } catch (err) {
    await connection.rollback();
    console.error(`[DB] trace=${traceId} 事务回滚:`, err.message);
    
    if (err.code === 'ER_DUP_ENTRY') {
      throw new Error(`traceId=${traceId} 已存在，请勿重复提交`);
    }
    throw err;
    
  } finally {
    connection.release();
  }
}

module.exports = {
  generateId,
  createTrace,
  updateTrace,
  createSpan,
  getTrace,
  getSpansByTraceId,
  getTraceWithSpans,
  listTraces,
  createTraceWithSpansTransaction,
  validateSpanHierarchy
};
