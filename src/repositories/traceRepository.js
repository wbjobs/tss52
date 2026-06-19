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

function parseTargetTime(timeStr) {
  if (timeStr === null || timeStr === undefined) {
    throw new Error('targetTime 不能为空');
  }
  
  if (typeof timeStr === 'number') {
    if (timeStr >= 1000000000000) {
      return timeStr;
    }
    return { relativeMs: timeStr };
  }
  
  if (typeof timeStr !== 'string') {
    throw new Error(`targetTime 格式错误: ${typeof timeStr}`);
  }
  
  const trimmed = timeStr.trim();
  
  if (/^\d+$/.test(trimmed)) {
    const num = parseInt(trimmed);
    if (num >= 1000000000000) {
      return num;
    }
    return { relativeMs: num };
  }
  
  const isoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?(Z|[+-]\d{2}:?\d{2})?$/;
  if (isoPattern.test(trimmed)) {
    const d = new Date(trimmed);
    if (!isNaN(d.getTime())) return d.getTime();
  }
  
  const datetimePattern = /^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
  const dtMatch = trimmed.match(datetimePattern);
  if (dtMatch) {
    const [, Y, M, D, h, m, s, ms] = dtMatch;
    const d = new Date(
      parseInt(Y), parseInt(M) - 1, parseInt(D),
      parseInt(h), parseInt(m), parseInt(s),
      ms ? parseInt(ms.padEnd(3, '0')) : 0
    );
    if (!isNaN(d.getTime())) return d.getTime();
  }
  
  const timePattern = /^(\d{2}):(\d{2}):(\d{2})(?:\.(\d{1,3}))?$/;
  const tMatch = trimmed.match(timePattern);
  if (tMatch) {
    const [, h, m, s, ms] = tMatch;
    const now = new Date();
    const d = new Date(
      now.getFullYear(), now.getMonth(), now.getDate(),
      parseInt(h), parseInt(m), parseInt(s),
      ms ? parseInt(ms.padEnd(3, '0')) : 0
    );
    if (!isNaN(d.getTime())) return d.getTime();
  }
  
  const d = new Date(trimmed);
  if (!isNaN(d.getTime())) return d.getTime();
  
  throw new Error(`无法解析时间格式: ${timeStr}，支持格式: 相对毫秒(123)、时间戳(1718889015123)、ISO(2026-06-20T10:30:15.123)、日期时间(2026-06-20 10:30:15.123)`);
}

function getSpanStateAtTime(span, targetRelativeMs) {
  if (targetRelativeMs < span.relativeStart) {
    return 'pending';
  } else if (targetRelativeMs >= span.relativeStart && targetRelativeMs < span.relativeEnd) {
    return 'running';
  } else {
    return 'completed';
  }
}

function buildSpanTree(spans) {
  const spanMap = {};
  spans.forEach(s => { spanMap[s.spanId] = { ...s, children: [] }; });
  
  const roots = [];
  spans.forEach(s => {
    if (s.parentSpanId && spanMap[s.parentSpanId]) {
      spanMap[s.parentSpanId].children.push(spanMap[s.spanId]);
    } else if (!s.parentSpanId) {
      roots.push(spanMap[s.spanId]);
    }
  });
  return roots;
}

async function replayTraceAtTime(traceId, targetTimeInput) {
  const traceData = await getTraceWithSpans(traceId);
  if (!traceData) {
    throw new Error(`traceId=${traceId} 不存在`);
  }
  
  const { trace, spans } = traceData;
  
  const minStartTime = Math.min(...spans.map(s => s.startTime));
  const maxEndTime = Math.max(...spans.map(s => s.endTime));
  const totalDuration = maxEndTime - minStartTime;
  
  const parsedTime = parseTargetTime(targetTimeInput);
  let targetAbsoluteTime;
  let targetRelativeMs;
  let timeType;
  
  if (typeof parsedTime === 'object' && parsedTime.relativeMs !== undefined) {
    targetRelativeMs = parsedTime.relativeMs;
    targetAbsoluteTime = minStartTime + targetRelativeMs;
    timeType = 'relative';
  } else {
    targetAbsoluteTime = parsedTime;
    targetRelativeMs = targetAbsoluteTime - minStartTime;
    timeType = 'absolute';
  }
  
  let timelinePosition = 'before_start';
  if (targetRelativeMs < 0) {
    timelinePosition = 'before_start';
  } else if (targetRelativeMs >= totalDuration) {
    timelinePosition = 'after_end';
  } else {
    timelinePosition = 'in_progress';
  }
  
  const replaySpans = spans.map(span => {
    const state = getSpanStateAtTime(span, targetRelativeMs);
    let elapsedMs = 0;
    let resultAtTime = null;
    let responseDataAtTime = null;
    let requestDataAtTime = null;
    
    if (state === 'pending') {
      elapsedMs = 0;
      resultAtTime = null;
      responseDataAtTime = null;
      requestDataAtTime = null;
    } else if (state === 'running') {
      elapsedMs = targetRelativeMs - span.relativeStart;
      resultAtTime = null;
      responseDataAtTime = null;
      requestDataAtTime = span.requestData;
    } else {
      elapsedMs = span.duration;
      resultAtTime = span.responseData?.output || null;
      responseDataAtTime = span.responseData;
      requestDataAtTime = span.requestData;
    }
    
    const percentComplete = state === 'completed' ? 100 :
      (state === 'running' ? Math.min(100, Math.max(0, (elapsedMs / span.duration) * 100)) : 0);
    
    return {
      ...span,
      state: state,
      elapsedMsAtTarget: elapsedMs,
      remainingMsAtTarget: state === 'running' ? (span.duration - elapsedMs) : (state === 'pending' ? span.duration : 0),
      percentComplete: Math.round(percentComplete * 10) / 10,
      resultAtTargetTime: resultAtTime,
      requestDataAtTargetTime: requestDataAtTime,
      responseDataAtTargetTime: responseDataAtTime
    };
  });
  
  const stats = {
    totalSpans: spans.length,
    pendingCount: replaySpans.filter(s => s.state === 'pending').length,
    runningCount: replaySpans.filter(s => s.state === 'running').length,
    completedCount: replaySpans.filter(s => s.state === 'completed').length,
    errorCount: replaySpans.filter(s => s.state === 'completed' && s.status === 'error').length
  };
  
  const replayTree = buildSpanTree(replaySpans);
  
  const activeTrace = replaySpans.find(s => s.state === 'running') || null;
  
  return {
    trace: {
      id: trace.id,
      traceId: trace.traceId,
      totalDuration: trace.total_duration,
      status: trace.status,
      createdAt: trace.created_at,
      startTime: minStartTime,
      endTime: maxEndTime
    },
    replayInfo: {
      targetTimeInput: targetTimeInput,
      targetAbsoluteTime: targetAbsoluteTime,
      targetAbsoluteTimeStr: new Date(targetAbsoluteTime).toISOString(),
      targetRelativeMs: targetRelativeMs,
      timeType: timeType,
      timelinePosition: timelinePosition,
      totalTraceDurationMs: totalDuration,
      percentOfTotal: Math.min(100, Math.max(0, (targetRelativeMs / totalDuration) * 100))
    },
    stats: stats,
    activeSpan: activeTrace ? {
      spanId: activeTrace.spanId,
      serviceName: activeTrace.serviceName,
      operationName: activeTrace.operationName,
      elapsedMs: activeTrace.elapsedMsAtTarget,
      totalDurationMs: activeTrace.duration,
      percentComplete: activeTrace.percentComplete
    } : null,
    spans: replaySpans,
    tree: replayTree
  };
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
  validateSpanHierarchy,
  replayTraceAtTime,
  parseTargetTime,
  getSpanStateAtTime
};
