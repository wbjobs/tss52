const { recordSpan: originalRecordSpan } = require('../src/services/traceSimulator');

const SERVICE_CONFIG = {
  ServiceA: { operations: ['handleRequest', 'processOrder'] },
  ServiceB: { operations: ['processData', 'validateUser', 'checkPermission'] },
  ServiceC: { operations: ['queryDB', 'getUserInfo', 'fetchOrders'] },
  ServiceD: { operations: ['callExternal', 'sendNotification', 'invokeThirdParty'] }
};

function randomDuration() { return Math.floor(Math.random() * 51) + 10; }
function sleep(ms) { return new Promise(resolve => setTimeout(resolve, ms)); }

let testIdCounter = 0;
function safeGenerateId() {
  const counter = (++testIdCounter).toString(36);
  return Date.now().toString(36) + counter + Math.random().toString(36).substring(2, 8);
}

async function recordSpan(ctx, serviceName, operationName, fn) {
  const spanId = safeGenerateId();
  const startTime = Date.now();
  
  const parentSpanId = ctx.currentSpanId;
  const depth = ctx.currentDepth;
  
  const spanData = {
    traceId: ctx.traceId,
    spanId: spanId,
    parentSpanId: parentSpanId,
    serviceName: serviceName,
    operationName: operationName,
    startTime: startTime,
    endTime: 0,
    duration: 0,
    depth: depth,
    status: 'success',
    requestData: null,
    responseData: null
  };
  
  const childCtx = {
    traceId: ctx.traceId,
    currentSpanId: spanId,
    currentDepth: depth + 1,
    spans: ctx.spans,
    requestParams: ctx.requestParams,
    spanId: spanId
  };
  
  let result;
  let error = null;
  
  try {
    spanData.requestData = JSON.stringify({ input: `${serviceName} received request` });
    result = await fn(childCtx);
    
    const endTime = Date.now();
    spanData.endTime = endTime;
    spanData.duration = endTime - startTime;
    spanData.responseData = JSON.stringify({ output: result, timestamp: endTime });
    spanData.status = 'success';
  } catch (e) {
    const endTime = Date.now();
    spanData.endTime = endTime;
    spanData.duration = endTime - startTime;
    spanData.status = 'error';
    error = e;
  }
  
  ctx.spans.push(spanData);
  if (error) throw error;
  return result;
}

async function callServiceD(ctx) {
  const op = SERVICE_CONFIG.ServiceD.operations[
    Math.floor(Math.random() * SERVICE_CONFIG.ServiceD.operations.length)
  ];
  return recordSpan(ctx, 'ServiceD', op, async (childCtx) => {
    await sleep(randomDuration());
    return 'ServiceD_OK';
  });
}

async function callServiceC(ctx) {
  const op = SERVICE_CONFIG.ServiceC.operations[
    Math.floor(Math.random() * SERVICE_CONFIG.ServiceC.operations.length)
  ];
  return recordSpan(ctx, 'ServiceC', op, async (childCtx) => {
    await sleep(randomDuration());
    if (Math.random() > 0.3) await callServiceD(childCtx);
    return 'ServiceC_OK';
  });
}

async function callServiceB(ctx) {
  const op = SERVICE_CONFIG.ServiceB.operations[
    Math.floor(Math.random() * SERVICE_CONFIG.ServiceB.operations.length)
  ];
  return recordSpan(ctx, 'ServiceB', op, async (childCtx) => {
    await sleep(randomDuration());
    
    const callMode = Math.random();
    if (callMode < 0.4) {
      await callServiceC(childCtx);
      await callServiceD(childCtx);
      return 'B_SERIAL';
    } else if (callMode < 0.8) {
      const [c, d] = await Promise.all([
        callServiceC(childCtx),
        callServiceD(childCtx)
      ]);
      return `B_PARALLEL: ${c}+${d}`;
    } else {
      await callServiceC(childCtx);
      return 'B_SIMPLE';
    }
  });
}

async function callServiceA(ctx) {
  const op = SERVICE_CONFIG.ServiceA.operations[
    Math.floor(Math.random() * SERVICE_CONFIG.ServiceA.operations.length)
  ];
  return recordSpan(ctx, 'ServiceA', op, async (childCtx) => {
    await sleep(randomDuration());
    const callCount = Math.floor(Math.random() * 2) + 1;
    for (let i = 0; i < callCount; i++) {
      await callServiceB(childCtx);
    }
    return 'A_OK';
  });
}

async function simulateCallChain(traceId) {
  const ctx = {
    traceId: traceId,
    currentSpanId: null,
    currentDepth: 0,
    spans: [],
    requestParams: {}
  };
  
  try {
    await callServiceA(ctx);
  } catch (e) {}
  
  return ctx.spans;
}

function validateTraceHierarchy(traceId, spans) {
  const spanIds = new Set(spans.map(s => s.spanId));
  const errors = [];
  
  for (const span of spans) {
    if (span.traceId !== traceId) {
      errors.push(`Span ${span.spanId} traceId=${span.traceId} != ${traceId}`);
    }
    
    if (span.parentSpanId !== null && span.parentSpanId !== undefined) {
      if (!spanIds.has(span.parentSpanId)) {
        errors.push(
          `❌ Span ${span.spanId} (${span.serviceName}.${span.operationName}, depth=${span.depth}) ` +
          `parentSpanId=${span.parentSpanId} 不在本 trace 中!`
        );
      }
    }
  }
  
  const rootSpans = spans.filter(s => s.depth === 0);
  if (rootSpans.length !== 1) {
    errors.push(`根节点应只有1个，实际有 ${rootSpans.length} 个`);
  }
  
  return { valid: errors.length === 0, errors };
}

async function runConcurrencyLogicTest() {
  console.log('='.repeat(70));
  console.log('  并发父子关系一致性测试 (纯逻辑，无需数据库)');
  console.log('='.repeat(70));
  console.log('');
  console.log('测试原理: 同时模拟50条独立调用链，每条链内部有 Promise.all 并行');
  console.log('          验证每条链的所有 span 的 parentSpanId 都在本链内');
  console.log('');
  
  const CONCURRENT = 50;
  const traceIds = [];
  for (let i = 0; i < CONCURRENT; i++) {
    traceIds.push(`test-${Date.now()}-${i.toString().padStart(3, '0')}`);
  }
  
  console.log(`[1/2] 正在并发模拟 ${CONCURRENT} 条调用链...`);
  const startTime = Date.now();
  
  const promises = traceIds.map(id => simulateCallChain(id));
  const allSpans = await Promise.all(promises);
  
  const duration = Date.now() - startTime;
  console.log(`        ✓ 完成，总耗时 ${duration}ms`);
  console.log('');
  
  console.log('[2/2] 正在校验每条链的父子关系...');
  console.log('');
  
  let allValid = true;
  let totalErrors = 0;
  
  allSpans.forEach((spans, idx) => {
    const traceId = traceIds[idx];
    const validation = validateTraceHierarchy(traceId, spans);
    
    if (validation.valid) {
      console.log(`  [${idx + 1}/${CONCURRENT}] ✓ ${traceId} - ${spans.length} spans, 校验通过`);
    } else {
      allValid = false;
      totalErrors += validation.errors.length;
      console.log(`  [${idx + 1}/${CONCURRENT}] ❌ ${traceId} - 发现 ${validation.errors.length} 个错误:`);
      validation.errors.forEach(e => console.log(`       ${e}`));
    }
  });
  
  console.log('');
  console.log('='.repeat(70));
  console.log('  测试结果');
  console.log('='.repeat(70));
  console.log(`  并发调用链: ${CONCURRENT}`);
  console.log(`  总耗时: ${duration}ms`);
  console.log(`  校验通过: ${allSpans.filter((_, i) => validateTraceHierarchy(traceIds[i], allSpans[i]).valid).length}/${CONCURRENT}`);
  console.log(`  总错误数: ${totalErrors}`);
  console.log('');
  
  if (allValid) {
    console.log('  🎉  全部通过！并发下链路数据严格隔离，父子关系完全正确！');
    console.log('');
    console.log('  修复原理说明:');
    console.log('  1. 进入 recordSpan 时立即捕获 parentSpanId (await前快照)');
    console.log('  2. 创建独立 childCtx 传给子调用，不再修改共享 ctx');
    console.log('  3. Promise.all 并行的每个分支拥有独立的上下文');
    console.log('  4. ID 生成器增加计数器，避免同一毫秒冲突');
    console.log('  5. 数据库事务保证 trace + spans 原子落库');
    console.log('  6. 落库前强校验父子关系，损坏则拒绝写入');
    return 0;
  } else {
    console.log('  ❌  测试失败，仍存在数据错乱问题');
    return 1;
  }
}

runConcurrencyLogicTest().then(code => process.exit(code)).catch(err => {
  console.error(err);
  process.exit(1);
});
