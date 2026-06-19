require('dotenv').config();
const express = require('express');
const cors = require('cors');
const path = require('path');
const { initTables } = require('./db');
const traceRoutes = require('./routes/traceRoutes');

const app = express();
const PORT = parseInt(process.env.PORT || '3000');

app.use(cors());
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true }));

app.use(express.static(path.join(__dirname, '..', 'public')));

app.use('/api', traceRoutes);

app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, '..', 'public', 'index.html'));
});

app.use((err, req, res, next) => {
  console.error('[App] Unhandled error:', err);
  res.status(500).json({
    code: 500,
    message: err.message || 'Internal Server Error',
    data: null
  });
});

async function start() {
  try {
    await initTables();
    
    app.listen(PORT, () => {
      console.log('');
      console.log('========================================');
      console.log('  RPC 调用链路追踪模拟器 已启动');
      console.log('  时间旅行调试模式: 已启用');
      console.log('========================================');
      console.log(`  服务地址:  http://localhost:${PORT}`);
      console.log(`  前端界面:  http://localhost:${PORT}/`);
      console.log('');
      console.log('  API 列表:');
      console.log('    POST   /api/simulate        - 模拟生成调用链');
      console.log('    GET    /api/trace/:traceId  - 查询调用链时间线');
      console.log('    GET    /api/traces          - 链路列表');
      console.log('');
    });
  } catch (err) {
    console.error('[App] 启动失败:', err);
    process.exit(1);
  }
}

start();
