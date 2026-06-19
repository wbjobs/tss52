const { generateId, createTrace, updateTrace, createSpan, createTraceWithSpansTransaction } = require('../repositories/traceRepository');

let idCounter = 0;
function safeGenerateId() {
  const counter = (++idCounter).toString(36);
  return Date.now().toString(36) + counter + Math.random().toString(36).substring(2, 8);
}

function randomDuration() {
  return Math.floor(Math.random() * 151) + 50;
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

const SERVICE_CONFIG = {
  ServiceA: {
    name: 'ServiceA',
    operations: ['handleRequest', 'processOrder'],
    color: '#3b82f6'
  },
  ServiceB: {
    name: 'ServiceB',
    operations: ['processData', 'validateUser', 'checkPermission'],
    color: '#10b981'
  },
  ServiceC: {
    name: 'ServiceC',
    operations: ['queryDB', 'getUserInfo', 'fetchOrders'],
    color: '#f59e0b'
  },
  ServiceD: {
    name: 'ServiceD',
    operations: ['callExternal', 'sendNotification', 'invokeThirdParty'],
    color: '#8b5cf6'
  }
};

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
    const reqData = {
      input: `${serviceName} received request`,
      timestamp: startTime,
      params: ctx.requestParams || {}
    };
    spanData.requestData = JSON.stringify(reqData);
    
    result = await fn(childCtx);
    
    const endTime = Date.now();
    spanData.endTime = endTime;
    spanData.duration = endTime - startTime;
    spanData.responseData = JSON.stringify({
      output: result,
      timestamp: endTime
    });
    spanData.status = 'success';
  } catch (e) {
    const endTime = Date.now();
    spanData.endTime = endTime;
    spanData.duration = endTime - startTime;
    spanData.status = 'error';
    spanData.responseData = JSON.stringify({
      error: e.message,
      timestamp: endTime
    });
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
    const results = ['NotificationSent', 'ThirdPartyOK', 'EmailDelivered'];
    return results[Math.floor(Math.random() * results.length)];
  });
}

async function callServiceC(ctx) {
  const op = SERVICE_CONFIG.ServiceC.operations[
    Math.floor(Math.random() * SERVICE_CONFIG.ServiceC.operations.length)
  ];
  
  return recordSpan(ctx, 'ServiceC', op, async (childCtx) => {
    await sleep(randomDuration());
    
    const needExternal = Math.random() > 0.5;
    if (needExternal) {
      await callServiceD(childCtx);
    }
    
    const results = ['DBQuerySuccess', 'UserFound', 'OrderListRetrieved'];
    return results[Math.floor(Math.random() * results.length)];
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
      const resultC = await callServiceC(childCtx);
      await callServiceD(childCtx);
      return `Processed: ${resultC}`;
    } else if (callMode < 0.8) {
      const [resultC, resultD] = await Promise.all([
        callServiceC(childCtx),
        callServiceD(childCtx)
      ]);
      return `ParallelOK: ${resultC} + ${resultD}`;
    } else {
      await callServiceC(childCtx);
      return 'SimpleProcess';
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
    const results = [];
    
    for (let i = 0; i < callCount; i++) {
      results.push(await callServiceB(childCtx));
    }
    
    return `FinalResult: [${results.join(', ')}]`;
  });
}

async function simulateCallChain(traceId, requestParams = {}) {
  const startTime = Date.now();
  
  const ctx = {
    traceId: traceId,
    currentSpanId: null,
    currentDepth: 0,
    spans: [],
    requestParams: requestParams
  };
  
  let finalResult;
  let overallStatus = 'success';
  
  try {
    finalResult = await callServiceA(ctx);
  } catch (e) {
    overallStatus = 'error';
    finalResult = { error: e.message };
  }
  
  const endTime = Date.now();
  const totalDuration = endTime - startTime;
  
  await createTraceWithSpansTransaction(traceId, totalDuration, overallStatus, ctx.spans);
  
  return {
    traceId: traceId,
    totalDuration: totalDuration,
    status: overallStatus,
    result: finalResult,
    spanCount: ctx.spans.length
  };
}

module.exports = {
  simulateCallChain,
  SERVICE_CONFIG
};
