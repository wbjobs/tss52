const express = require('express');
const { simulateCallChain } = require('../services/traceSimulator');
const { getTraceWithSpans, listTraces } = require('../repositories/traceRepository');

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

module.exports = router;
