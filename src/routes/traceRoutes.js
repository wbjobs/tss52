const express = require('express');
const { simulateCallChain } = require('../services/traceSimulator');
const { getTraceWithSpans, listTraces, replayTraceAtTime } = require('../repositories/traceRepository');

const router = express.Router();

router.post('/simulate', async (req, res) => {
  try {
    const { traceId, ...params } = req.body || {};
    
    if (!traceId) {
      return res.status(400).json({
        code: 400,
        message: '参数 traceId 不能为空',
        data: null
      });
    }
    
    if (typeof traceId !== 'string' || traceId.length > 64) {
      return res.status(400).json({
        code: 400,
        message: 'traceId 必须是字符串且长度不超过64字符',
        data: null
      });
    }
    
    const result = await simulateCallChain(traceId, params);
    
    res.json({
      code: 0,
      message: 'success',
      data: result
    });
  } catch (err) {
    console.error('[API] simulate error:', err);
    res.status(500).json({
      code: 500,
      message: err.message || 'Internal Server Error',
      data: null
    });
  }
});

router.get('/trace/:traceId', async (req, res) => {
  try {
    const { traceId } = req.params;
    
    if (!traceId) {
      return res.status(400).json({
        code: 400,
        message: '参数 traceId 不能为空',
        data: null
      });
    }
    
    const traceData = await getTraceWithSpans(traceId);
    
    if (!traceData) {
      return res.status(404).json({
        code: 404,
        message: `未找到 traceId=${traceId} 的调用链`,
        data: null
      });
    }
    
    const { trace, spans, tree } = traceData;
    
    const minTime = spans.length > 0 ? Math.min(...spans.map(s => s.startTime)) : 0;
    const maxTime = spans.length > 0 ? Math.max(...spans.map(s => s.endTime)) : 0;
    
    const timeline = spans.map(s => ({
      ...s,
      relativeStart: s.startTime - minTime,
      relativeEnd: s.endTime - minTime,
      percentStart: maxTime > minTime ? ((s.startTime - minTime) / (maxTime - minTime)) * 100 : 0,
      percentDuration: maxTime > minTime ? (s.duration / (maxTime - minTime)) * 100 : 100
    }));
    
    res.json({
      code: 0,
      message: 'success',
      data: {
        trace: {
          id: trace.id,
          traceId: trace.trace_id,
          totalDuration: trace.total_duration,
          status: trace.status,
          createdAt: trace.created_at
        },
        timeline: timeline,
        tree: tree,
        totalTime: maxTime - minTime,
        spanCount: spans.length
      }
    });
  } catch (err) {
    console.error('[API] getTrace error:', err);
    res.status(500).json({
      code: 500,
      message: err.message || 'Internal Server Error',
      data: null
    });
  }
});

router.get('/traces', async (req, res) => {
  try {
    const page = parseInt(req.query.page) || 1;
    const pageSize = parseInt(req.query.pageSize) || 20;
    
    const result = await listTraces(page, pageSize);
    
    res.json({
      code: 0,
      message: 'success',
      data: result
    });
  } catch (err) {
    console.error('[API] listTraces error:', err);
    res.status(500).json({
      code: 500,
      message: err.message || 'Internal Server Error',
      data: null
    });
  }
});

async function handleReplayRequest(req, res, traceId, targetTime) {
  try {
    if (!traceId) {
      return res.status(400).json({
        code: 400,
        message: '参数 traceId 不能为空',
        data: null
      });
    }
    
    if (!targetTime && targetTime !== 0) {
      return res.status(400).json({
        code: 400,
        message: '参数 targetTime 不能为空，支持格式: 相对毫秒(123)、时间戳(1718889015123)、ISO(2026-06-20T10:30:15.123)、日期时间(2026-06-20 10:30:15.123)',
        data: null
      });
    }
    
    const result = await replayTraceAtTime(traceId, targetTime);
    
    res.json({
      code: 0,
      message: 'success',
      data: result
    });
    
  } catch (err) {
    console.error('[API] replayTrace error:', err);
    
    if (err.message.includes('不存在')) {
      return res.status(404).json({
        code: 404,
        message: err.message,
        data: null
      });
    }
    
    if (err.message.includes('无法解析时间格式')) {
      return res.status(400).json({
        code: 400,
        message: err.message,
        data: null
      });
    }
    
    res.status(500).json({
      code: 500,
      message: err.message || 'Internal Server Error',
      data: null
    });
  }
}

router.post('/trace/:traceId/replay', async (req, res) => {
  const { traceId } = req.params;
  const { targetTime } = req.body || {};
  await handleReplayRequest(req, res, traceId, targetTime);
});

router.get('/trace/:traceId/replay', async (req, res) => {
  const { traceId } = req.params;
  const { targetTime } = req.query;
  await handleReplayRequest(req, res, traceId, targetTime);
});

module.exports = router;
