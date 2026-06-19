const http = require('http');

const API_HOST = 'localhost';
const API_PORT = 3000;
const CONCURRENT_REQUESTS = 50;

function httpRequest(options, body = null) {
  return new Promise((resolve, reject) => {
    const req = http.request(options, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try {
          resolve({
            statusCode: res.statusCode,
            data: JSON.parse(data)
          });
        } catch (e) {
          resolve({ statusCode: res.statusCode, rawData: data });
        }
      });
    });
    req.on('error', reject);
    if (body) req.write(JSON.stringify(body));
    req.end();
  });
}

async function simulateCall(traceId) {
  return httpRequest({
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/simulate',
    method: 'POST',
    headers: { 'Content-Type': 'application/json' }
  }, { traceId, userId: `user_${traceId}` });
}

async function getTrace(traceId) {
  return httpRequest({
    hostname: API_HOST,
    port: API_PORT,
    path: '/api/trace/' + encodeURIComponent(traceId),
    method: 'GET'
  });
}

function validateTraceHierarchy(traceData, traceId) {
  const { timeline } = traceData;
  const spanIds = new Set(timeline.map(s => s.spanId));
  const errors = [];
  
  timeline.forEach(span => {
    if (span.traceId !== traceId) {
      errors.push(`Span ${span.spanId} 的 traceId=${span.traceId} 不等于预期的 ${traceId}`);
    }
    
    if (span.parentSpanId !== null && span.parentSpanId !== undefined) {
      if (!spanIds.has(span.parentSpanId)) {
        errors.push(
          `Span ${span.spanId} (${span.serviceName}.${span.operationName}, depth=${span.depth}) ` +
          `的 parentSpanId=${span.parentSpanId} 在本 trace 中找不到!`
        );
      }
    }
    
    if (span.depth === 0 && span.parentSpanId !== null) {
      errors.push(`深度为0的根Span ${span.spanId} 不应该有 parentSpanId`);
    }
  });
  
  const rootSpans = timeline.filter(s => s.depth === 0);
  if (rootSpans.length !== 1) {
    errors.push(`根节点应该只有1个，实际有 ${rootSpans.length} 个`);
  } else if (rootSpans[0].serviceName !== 'ServiceA') {
    errors.push(`根节点应该是 ServiceA，实际是 ${rootSpans[0].serviceName}`);
  }
  
  timeline.forEach(span => {
    if (span.parentSpanId) {
      const parent = timeline.find(s => s.spanId === span.parentSpanId);
      if (parent && parent.depth !== span.depth - 1) {
        errors.push(
          `Span ${span.spanId} (depth=${span.depth}) 的父节点 ${parent.spanId} ` +
          `depth=${parent.depth}，应该为 ${span.depth - 1}`
        );
      }
      if (parent && parent.startTime > span.startTime) {
        errors.push(
          `Span ${span.spanId} 开始时间早于父节点 ${parent.spanId}!`
        );
      }
      if (parent && parent.endTime < span.endTime) {
        errors.push(
          `Span ${span.spanId} 结束时间晚于父节点 ${parent.spanId}!`
        );
      }
    }
  });
  
  return { valid: errors.length === 0, errors };
}

async function runConcurrentTest() {
  console.log('='.repeat(70));
  console.log('  并发调用链路追踪 - 父子关系一致性测试');
  console.log('='.repeat(70));
  console.log(`并发请求数: ${CONCURRENT_REQUESTS}`);
  console.log(`目标地址: http://${API_HOST}:${API_PORT}`);
  console.log('');
  
  const traceIds = [];
  for (let i = 0; i < CONCURRENT_REQUESTS; i++) {
    traceIds.push(`concurrency-test-${Date.now()}-${i.toString().padStart(3, '0')}`);
  }
  
  console.log('[1/3] 正在发送并发模拟请求...');
  const startTime = Date.now();
  
  const promises = traceIds.map(id => simulateCall(id));
  const results = await Promise.all(promises);
  
  const simulateDuration = Date.now() - startTime;
  const successCount = results.filter(r => r.statusCode === 200 && r.data.code === 0).length;
  
  console.log(`        ✓ 完成 ${successCount}/${CONCURRENT_REQUESTS} 个成功`);
  console.log(`        ✓ 总耗时: ${simulateDuration}ms`);
  console.log('');
  
  results.forEach((r, i) => {
    if (r.statusCode !== 200 || r.data.code !== 0) {
      console.log(`  ❌ trace=${traceIds[i]} 失败:`, r.data?.message || r.rawData);
    }
  });
  
  console.log('[2/3] 正在查询并校验每条链路的父子关系...');
  console.log('');
  
  let allValid = true;
  let totalErrors = 0;
  const startTime2 = Date.now();
  
  const queryPromises = traceIds.map(async (traceId, idx) => {
    const result = await getTrace(traceId);
    if (result.statusCode !== 200 || result.data.code !== 0) {
      console.log(`  [${idx + 1}/${CONCURRENT_REQUESTS}] ❌ ${traceId} - 查询失败`);
      return { valid: false, errors: ['查询失败'] };
    }
    
    const validation = validateTraceHierarchy(result.data.data, traceId);
    
    if (validation.valid) {
      console.log(`  [${idx + 1}/${CONCURRENT_REQUESTS}] ✓ ${traceId} - ${result.data.data.spanCount} spans, 校验通过`);
    } else {
      allValid = false;
      totalErrors += validation.errors.length;
      console.log(`  [${idx + 1}/${CONCURRENT_REQUESTS}] ❌ ${traceId} - 发现 ${validation.errors.length} 个错误:`);
      validation.errors.forEach(e => console.log(`       - ${e}`));
    }
    
    return validation;
  });
  
  const validations = await Promise.all(queryPromises);
  const queryDuration = Date.now() - startTime2;
  
  const validCount = validations.filter(v => v.valid).length;
  
  console.log('');
  console.log('[3/3] 测试完成');
  console.log('');
  console.log('='.repeat(70));
  console.log('  测试结果汇总');
  console.log('='.repeat(70));
  console.log(`  并发请求数:      ${CONCURRENT_REQUESTS}`);
  console.log(`  模拟请求耗时:    ${simulateDuration}ms`);
  console.log(`  查询校验耗时:    ${queryDuration}ms`);
  console.log(`  模拟成功数:      ${successCount}/${CONCURRENT_REQUESTS}`);
  console.log(`  父子关系正确:    ${validCount}/${CONCURRENT_REQUESTS}`);
  console.log(`  总错误数:        ${totalErrors}`);
  console.log('');
  
  if (allValid && successCount === CONCURRENT_REQUESTS) {
    console.log('  🎉  全部通过！并发下链路数据严格隔离，父子关系完全正确！');
    process.exit(0);
  } else {
    console.log('  ❌  测试失败，存在数据错乱问题');
    process.exit(1);
  }
}

runConcurrentTest().catch(err => {
  console.error('测试执行失败:', err.message);
  console.error('请确保服务已启动: npm start');
  process.exit(1);
});
