# 🔮 RPC 调用链路追踪模拟器 (Time Travel Debug Mode)

带**时间旅行**调试功能的微服务 RPC 调用链路追踪模拟器。模拟 ServiceA → ServiceB → ServiceC → ServiceD 的调用链路，支持时间倒放/快进查看任意时间点的调用状态。

## ✨ 功能特性

- 🚀 **调用链模拟**：模拟多级微服务调用（串行/并行混合），每个节点随机耗时 50-200ms
- 🗄️ **MySQL 落库**：每次模拟调用的完整链路数据持久化存储
- 🔍 **链路查询 API**：根据 traceId 查询完整时间线
- ⏱ **时间旅行调试**：
  - 拖动时间滑块查看任意时间点状态
  - 播放/暂停自动回放，支持 0.5x / 1x / 2x / 5x 倍速
  - 一键跳转到调用开始/结束
  - 进行中的 Span 显示条纹动画效果
  - 扫描线特效增强沉浸感
- 📊 **瀑布图可视化**：每个节点的开始/结束时间、耗时、调用深度清晰展示
- 📋 **历史记录列表**：快速查看和加载过往调用链

## 🏗️ 项目结构

```
tss52/
├── public/
│   └── index.html            # 时间旅行调试前端界面
├── sql/
│   └── init.sql              # 数据库初始化 SQL
├── src/
│   ├── app.js                # Express 应用入口
│   ├── db.js                 # MySQL 连接池 + 自动建表
│   ├── repositories/
│   │   └── traceRepository.js # 数据访问层
│   ├── routes/
│   │   └── traceRoutes.js    # API 路由
│   └── services/
│       └── traceSimulator.js # 调用链模拟核心逻辑
├── .env                      # 环境变量配置
├── .env.example              # 环境变量示例
└── package.json
```

## 🚀 快速开始

### 1. 环境要求

- Node.js >= 16
- MySQL >= 5.7 / >= 8.0

### 2. 数据库准备

方式一：手动执行 SQL
```bash
mysql -u root -p < sql/init.sql
```

方式二：启动应用时自动建表（首次启动会自动创建表）

### 3. 配置环境变量

```bash
# 复制示例并修改
cp .env.example .env

# 编辑 .env
PORT=3000
DB_HOST=localhost
DB_PORT=3306
DB_USER=root
DB_PASSWORD=123456
DB_NAME=rpc_trace
```

### 4. 安装依赖

```bash
npm install
```

### 5. 启动服务

```bash
npm start
```

启动成功后控制台会显示：

```
========================================
  RPC 调用链路追踪模拟器 已启动
  时间旅行调试模式: 已启用
========================================
  服务地址:  http://localhost:3000
  前端界面:  http://localhost:3000/
```

### 6. 打开前端

浏览器访问：**http://localhost:3000/**

## 📖 API 文档

### 1. 模拟生成调用链

**POST** `/api/simulate`

请求体：
```json
{
  "traceId": "trace-001",
  "userId": "123",
  "action": "placeOrder"
}
```

| 参数 | 类型 | 必填 | 说明 |
|------|------|------|------|
| traceId | string | ✅ | 链路追踪ID，最长64字符 |
| 其他字段 | any | ❌ | 自定义参数，会传递给调用链模拟 |

响应示例：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "traceId": "trace-001",
    "totalDuration": 892,
    "status": "success",
    "result": "FinalResult: [ParallelOK: DBQuerySuccess + NotificationSent]",
    "spanCount": 7
  }
}
```

### 2. 查询调用链时间线

**GET** `/api/trace/:traceId`

响应示例：
```json
{
  "code": 0,
  "message": "success",
  "data": {
    "trace": {
      "id": 1,
      "traceId": "trace-001",
      "totalDuration": 892,
      "status": "success",
      "createdAt": "2026-06-20T10:00:00.000Z"
    },
    "timeline": [
      {
        "spanId": "xxx",
        "parentSpanId": null,
        "serviceName": "ServiceA",
        "operationName": "handleRequest",
        "startTime": 1749888000000,
        "endTime": 1749888000892,
        "duration": 892,
        "depth": 0,
        "status": "success",
        "relativeStart": 0,
        "relativeEnd": 892,
        "percentStart": 0,
        "percentDuration": 100,
        "requestData": { ... },
        "responseData": { ... }
      }
    ],
    "tree": [ { ...children: [...] } ],
    "totalTime": 892,
    "spanCount": 7
  }
}
```

### 3. 调用链列表

**GET** `/api/traces?page=1&pageSize=20`

## 🎯 时间旅行调试功能说明

### 核心功能

| 功能 | 说明 |
|------|------|
| ⏮ **跳到开始** | 时间回到 0ms，所有调用显示为"未开始" |
| ▶ **播放/暂停** | 自动按时间线推进，模拟真实调用过程 |
| ⏭ **跳到结束** | 时间前进到末尾，显示完整最终状态 |
| 🎚 **倍速控制** | 0.5x / 1x / 2x / 5x 回放速度切换 |
| 👆 **拖拽滑块** | 精确定位到任意毫秒时间点 |

### Span 状态说明

| 状态 | 样式 | 含义 |
|------|------|------|
| **未开始 (Future)** | 半透明灰色 | 当前时间点该调用尚未触发 |
| **进行中 (Active)** | 紫色条纹动画 + 发光边框 | 调用正在执行中，显示已用时间/总时间 |
| **已完成 (Completed)** | 彩色实色条 | 调用已完成，显示最终耗时 |

### 使用场景演示

1. **生成调用链** → 输入 traceId 点击"生成调用链"
2. **查询调用链** → 在历史记录中点击，或输入 traceId 查询
3. **开始时间旅行** → 点击"跳到开始"，然后点击播放按钮
4. **观察调用顺序** → 观察 ServiceA 启动 → ServiceB → ServiceC/ServiceD 并行调用的完整过程
5. **精确定位问题** → 拖动滑块到某个时间点，查看正在执行的调用详情
6. **查看 Span 详情** → 点击任意一行，查看请求/响应数据、父子关系等

## 🧪 调用链路生成规则

模拟器会随机组合以下调用模式，每次生成的调用链都不相同：

```
ServiceA (入口)
  └── ServiceB (1~2 次调用)
        ├── 模式1: 串行 ServiceC → ServiceD
        ├── 模式2: 并行 ServiceC + ServiceD
        └── 模式3: 仅 ServiceC
              └── ServiceD (50% 概率)
```

- 每个节点随机耗时：**50~200ms**
- 操作名称从对应服务的操作池中随机选择
- 50% 概率出现并行调用，更接近真实微服务场景

## 📝 数据表结构

### traces 表（调用链路主表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| trace_id | VARCHAR(64) | 唯一追踪ID |
| total_duration | INT | 总耗时(ms) |
| status | VARCHAR(16) | success/error/running |
| created_at | DATETIME | 创建时间 |

### spans 表（调用节点明细表）

| 字段 | 类型 | 说明 |
|------|------|------|
| id | BIGINT | 主键 |
| trace_id | VARCHAR(64) | 关联 trace |
| span_id | VARCHAR(64) | Span 唯一ID |
| parent_span_id | VARCHAR(64) | 父SpanID (根节点为NULL) |
| service_name | VARCHAR(64) | 服务名 |
| operation_name | VARCHAR(128) | 操作名 |
| start_time | BIGINT | 开始时间戳(ms) |
| end_time | BIGINT | 结束时间戳(ms) |
| duration | INT | 耗时(ms) |
| depth | INT | 调用深度 (0=根) |
| status | VARCHAR(16) | success/error |
| request_data | TEXT | 请求JSON |
| response_data | TEXT | 响应JSON |

## 🔧 开发模式

```bash
# 自动重启模式 (Node.js >= 18.11)
npm run dev
```

## 📌 默认配置

- **服务端口**：3000
- **数据库**：rpc_trace
- **MySQL 地址**：localhost:3306
- **用户名/密码**：root / 123456 (请修改 .env)

一切就绪，开始你的时间旅行调试之旅！ 🎉
