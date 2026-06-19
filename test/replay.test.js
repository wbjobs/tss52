const { parseTargetTime, getSpanStateAtTime } = require('../src/repositories/traceRepository');

console.log('='.repeat(70));
console.log('  时间回溯重放功能测试');
console.log('='.repeat(70));
console.log('');

function testParseTargetTime() {
  console.log('[1/4] 测试时间格式解析...');
  console.log('');
  
  const testCases = [
    { input: '123', desc: '相对毫秒(字符串)', expected: { relativeMs: 123 } },
    { input: 123, desc: '相对毫秒(数字)', expected: { relativeMs: 123 } },
    { input: '1718889015123', desc: '绝对时间戳(字符串)', expected: 1718889015123 },
    { input: 1718889015123, desc: '绝对时间戳(数字)', expected: 1718889015123 },
    { input: '2026-06-20T10:30:15.123Z', desc: 'ISO格式带Z', expectedType: 'number' },
    { input: '2026-06-20T10:30:15.123', desc: 'ISO格式不带Z', expectedType: 'number' },
    { input: '2026-06-20 10:30:15.123', desc: '日期时间带毫秒', expectedType: 'number' },
    { input: '2026-06-20 10:30:15', desc: '日期时间不带毫秒', expectedType: 'number' },
    { input: '10:30:15.123', desc: '时间带毫秒(今天)', expectedType: 'number' },
    { input: '10:30:15', desc: '时间不带毫秒(今天)', expectedType: 'number' },
  ];
  
  let allPassed = true;
  testCases.forEach((tc, i) => {
    try {
      const result = parseTargetTime(tc.input);
      let passed = false;
      
      if (tc.expected !== undefined) {
        if (typeof tc.expected === 'object' && tc.expected.relativeMs !== undefined) {
          passed = typeof result === 'object' && result.relativeMs === tc.expected.relativeMs;
        } else {
          passed = result === tc.expected;
        }
      } else if (tc.expectedType) {
        passed = typeof result === tc.expectedType && !isNaN(result);
      }
      
      if (passed) {
        console.log(`  ✓ [${i + 1}] ${tc.desc}: ${JSON.stringify(tc.input)} → OK`);
      } else {
        console.log(`  ❌ [${i + 1}] ${tc.desc}: ${JSON.stringify(tc.input)} → 期望 ${JSON.stringify(tc.expected) || tc.expectedType}, 实际 ${JSON.stringify(result)}`);
        allPassed = false;
      }
    } catch (e) {
      console.log(`  ❌ [${i + 1}] ${tc.desc}: ${JSON.stringify(tc.input)} → 异常: ${e.message}`);
      allPassed = false;
    }
  });
  
  const errorCases = [
    { input: 'invalid-time', desc: '无效时间字符串' },
    { input: null, desc: 'null' },
    { input: undefined, desc: 'undefined' },
  ];
  
  console.log('');
  console.log('  错误场景测试:');
  errorCases.forEach((tc, i) => {
    try {
      parseTargetTime(tc.input);
      console.log(`  ❌ [E${i + 1}] ${tc.desc}: 应该抛出异常但没有`);
      allPassed = false;
    } catch (e) {
      console.log(`  ✓ [E${i + 1}] ${tc.desc}: 正确抛出异常`);
    }
  });
  
  console.log('');
  return allPassed;
}

function testGetSpanStateAtTime() {
  console.log('[2/4] 测试Span状态判定...');
  console.log('');
  
  const span = {
    relativeStart: 100,
    relativeEnd: 300,
    duration: 200
  };
  
  const testCases = [
    { time: 50, expected: 'pending', desc: '开始前' },
    { time: 99, expected: 'pending', desc: '即将开始' },
    { time: 100, expected: 'running', desc: '刚开始' },
    { time: 150, expected: 'running', desc: '进行中' },
    { time: 299, expected: 'running', desc: '即将结束' },
    { time: 300, expected: 'completed', desc: '刚结束' },
    { time: 400, expected: 'completed', desc: '结束后' },
  ];
  
  let allPassed = true;
  testCases.forEach((tc, i) => {
    const result = getSpanStateAtTime(span, tc.time);
    if (result === tc.expected) {
      console.log(`  ✓ [${i + 1}] ${tc.desc}: time=${tc.time}ms → ${result}`);
    } else {
      console.log(`  ❌ [${i + 1}] ${tc.desc}: time=${tc.time}ms → 期望 ${tc.expected}, 实际 ${result}`);
      allPassed = false;
    }
  });
  
  console.log('');
  return allPassed;
}

function testReplaySimulation() {
  console.log('[3/4] 模拟时间回溯重放场景...');
  console.log('');
  
  const mockSpans = [
    { spanId: 'span-A', parentSpanId: null, serviceName: 'ServiceA', operationName: 'handleRequest',
      startTime: 1000, endTime: 1800, duration: 800, depth: 0,
      relativeStart: 0, relativeEnd: 800,
      requestData: { input: 'A request' },
      responseData: { output: 'FinalResult: [OK]' } },
    { spanId: 'span-B', parentSpanId: 'span-A', serviceName: 'ServiceB', operationName: 'processData',
      startTime: 1100, endTime: 1600, duration: 500, depth: 1,
      relativeStart: 100, relativeEnd: 600,
      requestData: { input: 'B request' },
      responseData: { output: 'Processed: OK' } },
    { spanId: 'span-C', parentSpanId: 'span-B', serviceName: 'ServiceC', operationName: 'queryDB',
      startTime: 1200, endTime: 1350, duration: 150, depth: 2,
      relativeStart: 200, relativeEnd: 350,
      requestData: { input: 'C request' },
      responseData: { output: 'DBQuerySuccess' } },
    { spanId: 'span-D', parentSpanId: 'span-B', serviceName: 'ServiceD', operationName: 'callExternal',
      startTime: 1380, endTime: 1500, duration: 120, depth: 2,
      relativeStart: 380, relativeEnd: 500,
      requestData: { input: 'D request' },
      responseData: { output: 'NotificationSent' } },
  ];
  
  const minStartTime = 1000;
  const totalDuration = 800;
  
  function simulateReplay(targetRelativeMs) {
    return mockSpans.map(span => {
      const state = getSpanStateAtTime(span, targetRelativeMs);
      let elapsedMs = 0;
      let result = null;
      let req = null;
      let res = null;
      
      if (state === 'pending') {
        elapsedMs = 0;
      } else if (state === 'running') {
        elapsedMs = targetRelativeMs - span.relativeStart;
        req = span.requestData;
      } else {
        elapsedMs = span.duration;
        result = span.responseData?.output || null;
        req = span.requestData;
        res = span.responseData;
      }
      
      const pct = state === 'completed' ? 100 :
        (state === 'running' ? Math.min(100, (elapsedMs / span.duration) * 100) : 0);
      
      return {
        ...span,
        state,
        elapsedMsAtTarget: elapsedMs,
        percentComplete: Math.round(pct * 10) / 10,
        resultAtTargetTime: result,
        hasRequest: !!req,
        hasResponse: !!res
      };
    });
  }
  
  const testPoints = [
    { time: 50, desc: '调用链开始前' },
    { time: 0, desc: '第0ms (刚启动)' },
    { time: 150, desc: '第150ms (A运行中，B待启动)' },
    { time: 250, desc: '第250ms (A/B/C都在运行)' },
    { time: 400, desc: '第400ms (C已完成，D刚启动，B在运行)' },
    { time: 550, desc: '第550ms (C/D已完成，B待完成)' },
    { time: 700, desc: '第700ms (B已完成，A待完成)' },
    { time: 800, desc: '第800ms (全部完成)' },
    { time: 1000, desc: '第1000ms (完成后)' },
  ];
  
  let allPassed = true;
  
  testPoints.forEach((tp, i) => {
    const result = simulateReplay(tp.time);
    const pending = result.filter(s => s.state === 'pending').length;
    const running = result.filter(s => s.state === 'running').length;
    const completed = result.filter(s => s.state === 'completed').length;
    
    console.log(`  [${i + 1}] ${tp.desc}: time=${tp.time}ms`);
    console.log(`        状态: ${pending}待启动 | ${running}运行中 | ${completed}已完成`);
    
    result.forEach(s => {
      const bar = '█'.repeat(Math.floor(s.percentComplete / 10)) + '░'.repeat(10 - Math.floor(s.percentComplete / 10));
      const statusIcon = s.state === 'pending' ? '⏸' : (s.state === 'running' ? '⚡' : '✓');
      const resultText = s.resultAtTargetTime ? ` → ${s.resultAtTargetTime}` : '';
      console.log(`          ${statusIcon} ${s.serviceName}.${s.operationName} ${bar} ${s.percentComplete}% (${s.elapsedMsAtTarget}/${s.duration}ms)${resultText}`);
    });
    
    if (tp.time === 0) {
      const spanA = result.find(s => s.spanId === 'span-A');
      if (spanA.state !== 'running' || spanA.elapsedMsAtTarget !== 0) {
        console.log('          ❌ Span A 状态错误!');
        allPassed = false;
      } else {
        console.log('          ✓ Span A 状态正确');
      }
    }
    
    if (tp.time === 250) {
      const running = result.filter(s => s.state === 'running').map(s => s.spanId).sort();
      const expected = ['span-A', 'span-B', 'span-C'].sort();
      if (JSON.stringify(running) === JSON.stringify(expected)) {
        console.log('          ✓ 运行中的Span正确: A, B, C');
      } else {
        console.log(`          ❌ 运行中的Span错误，期望 ${JSON.stringify(expected)}, 实际 ${JSON.stringify(running)}`);
        allPassed = false;
      }
    }
    
    if (tp.time === 800) {
      if (result.every(s => s.state === 'completed' && s.percentComplete === 100 && s.resultAtTargetTime)) {
        console.log('          ✓ 所有Span已完成，结果正确');
      } else {
        console.log('          ❌ 有Span未正确完成');
        allPassed = false;
      }
    }
    
    console.log('');
  });
  
  return allPassed;
}

function testEdgeCases() {
  console.log('[4/4] 测试边界情况...');
  console.log('');
  
  let allPassed = true;
  
  const span = { relativeStart: 100, relativeEnd: 200, duration: 100 };
  
  const exactStart = getSpanStateAtTime(span, 100);
  if (exactStart === 'running') {
    console.log('  ✓ 边界: 等于startTime → running');
  } else {
    console.log(`  ❌ 边界: 等于startTime → 期望 running, 实际 ${exactStart}`);
    allPassed = false;
  }
  
  const exactEnd = getSpanStateAtTime(span, 200);
  if (exactEnd === 'completed') {
    console.log('  ✓ 边界: 等于endTime → completed');
  } else {
    console.log(`  ❌ 边界: 等于endTime → 期望 completed, 实际 ${exactEnd}`);
    allPassed = false;
  }
  
  const beforeOne = getSpanStateAtTime(span, 99);
  if (beforeOne === 'pending') {
    console.log('  ✓ 边界: start前1ms → pending');
  } else {
    console.log(`  ❌ 边界: start前1ms → 期望 pending, 实际 ${beforeOne}`);
    allPassed = false;
  }
  
  const beforeEndOne = getSpanStateAtTime(span, 199);
  if (beforeEndOne === 'running') {
    console.log('  ✓ 边界: end前1ms → running');
  } else {
    console.log(`  ❌ 边界: end前1ms → 期望 running, 实际 ${beforeEndOne}`);
    allPassed = false;
  }
  
  const isoTime = parseTargetTime('2026-06-20T10:30:15.123');
  const dateTime = parseTargetTime('2026-06-20 10:30:15.123');
  if (Math.abs(isoTime - dateTime) <= 1000) {
    console.log('  ✓ ISO和日期时间格式解析结果一致');
  } else {
    console.log(`  ❌ ISO和日期时间格式解析结果不一致: ${isoTime} vs ${dateTime}`);
    allPassed = false;
  }
  
  const relative1 = parseTargetTime('500');
  const relative2 = parseTargetTime(500);
  if (typeof relative1 === 'object' && relative1.relativeMs === 500 &&
      typeof relative2 === 'object' && relative2.relativeMs === 500) {
    console.log('  ✓ 相对时间字符串和数字解析一致');
  } else {
    console.log('  ❌ 相对时间解析不一致');
    allPassed = false;
  }
  
  console.log('');
  return allPassed;
}

async function runAllTests() {
  const results = [];
  
  results.push({ name: '时间格式解析', passed: testParseTargetTime() });
  results.push({ name: 'Span状态判定', passed: testGetSpanStateAtTime() });
  results.push({ name: '模拟重放场景', passed: testReplaySimulation() });
  results.push({ name: '边界情况', passed: testEdgeCases() });
  
  console.log('='.repeat(70));
  console.log('  测试结果汇总');
  console.log('='.repeat(70));
  
  results.forEach((r, i) => {
    console.log(`  ${r.passed ? '✓' : '❌'} [${i + 1}] ${r.name}: ${r.passed ? '通过' : '失败'}`);
  });
  
  const allPassed = results.every(r => r.passed);
  console.log('');
  
  if (allPassed) {
    console.log('  🎉  全部测试通过！');
    console.log('');
    console.log('  API 使用方式:');
    console.log('    POST /api/trace/:traceId/replay');
    console.log('    GET  /api/trace/:traceId/replay?targetTime=xxx');
    console.log('');
    console.log('  targetTime 支持格式:');
    console.log('    • 相对毫秒: 123 (相对调用链开始时间)');
    console.log('    • 绝对时间戳: 1718889015123');
    console.log('    • ISO格式: 2026-06-20T10:30:15.123Z');
    console.log('    • 日期时间: 2026-06-20 10:30:15.123');
    console.log('    • 仅时间: 10:30:15.123 (今天)');
    console.log('');
    process.exit(0);
  } else {
    console.log('  ❌  部分测试失败');
    process.exit(1);
  }
}

runAllTests().catch(err => {
  console.error('测试执行失败:', err);
  process.exit(1);
});
