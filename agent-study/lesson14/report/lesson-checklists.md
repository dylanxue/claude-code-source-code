# Lesson 1-6 分析检查清单

## Lesson 1: Minimal Agent (01-minimal-agent.md)

### 核心目标
- 实现最小可运行的 Coding Agent 闭环

### 必须检查的文件
- [ ] `src/index.js` - CLI入口
- [ ] `src/bootstrap/create-agent-app.js` - 装配session、model、tool registry、runtime
- [ ] `src/core/agent-runtime.js` - Agent循环核心
- [ ] `src/core/session.js` - 保存user/assistant/tool消息
- [ ] `src/core/tool-registry.js` - 统一注册和执行工具
- [ ] `src/model/mock-model.js` - 简化版模型决策器
- [ ] `src/tools/*.js` - 具体工具实现

### 关键架构点验证
- [ ] Agent = 状态 + 决策 + 工具 + 循环 (不只是LLM)
- [ ] Tool registry是稳定扩展点
- [ ] Session是后续高级能力的地基

---

## Lesson 2: Tooling Runtime (02-tooling-runtime.md)

### 核心目标
- 给工具加输入schema
- 新增write_file与grep工具
- 把MockModel替换成真实LLM adapter

### 必须检查的文件
- [ ] `src/core/tool-registry.js` - 带schema的工具注册
- [ ] `src/tools/grep_search.js` - 代码检索工具
- [ ] `src/tools/read_file.js` - 读取上下文
- [ ] `src/tools/write_file.js` - 产出结果
- [ ] `src/tools/bash.js` - 执行外部命令
- [ ] `src/core/agent-runtime.js` - 记录工具失败

### 关键架构点验证
- [ ] 每个工具有name/description/inputSchema/execute
- [ ] Runtime记录工具失败到session
- [ ] 工具执行层稳定，可扩展更多工具

---

## Lesson 3: Real LLM Adapter (03-real-llm-adapter.md)

### 核心目标
- 把MockModel推进成真实模型适配层
- 支持OpenAI-compatible API
- 实现tool calling完整闭环

### 必须检查的文件
- [ ] `src/model/create-model.js` - 加载配置创建模型适配器
- [ ] `src/model/openai-responses-model.js` - OpenAI Responses API适配
- [ ] `src/core/agent-runtime.js` - 保存toolCallId，让结果能回传

### 关键架构点验证
- [ ] Provider协议被隔离在adapter层
- [ ] Tool calling保存toolCallId用于对齐
- [ ] 支持一轮返回多个tool_calls，整组执行完再回传
- [ ] 默认打印完整LLM trace，但隐藏API key
- [ ] 支持LLM_TRACE环境变量控制

---

## Lesson 4: Session Persistence (04-session-persistence.md)

### 核心目标
- Session可持久化到磁盘
- 支持resume恢复会话
- 实现内部消息协议层
- 支持多协议Adapter(OpenAI+Anthropic)

### 必须检查的文件
- [ ] `src/core/session.js` - 带sessionId、时间戳、序列化能力
- [ ] `src/core/session-store.js` - 会话文件保存、加载、latest查找
- [ ] `src/core/message-protocol.js` - 内部消息协议层
- [ ] `src/model/anthropic-messages-model.js` - Anthropic Messages API适配
- [ ] `src/index.js` - 解析--resume参数

### 关键架构点验证
- [ ] Session可保存到.sessions/<sessionId>.json
- [ ] 支持--resume latest和--resume <file>两种方式
- [ ] 内部消息协议有四类: text/final_answer/tool_request/tool_result
- [ ] Provider-specific映射封装在adapter内
- [ ] OpenAI和Anthropic的差异被明确拆开

---

## Lesson 5: Session Compaction (05-session-compaction.md)

### 核心目标
- Session可压缩(compact)
- 实现token预算管理
- 支持repeated compaction合并旧summary
- 运行过程中持续落盘

### 必须检查的文件
- [ ] `src/core/session-compaction.js` - estimateSessionTokens/shouldCompact/compactSession
- [ ] `src/core/session.js` - compaction metadata、clone/replaceWith/recordCompaction
- [ ] `src/core/agent-runtime.js` - 每轮检查auto compact
- [ ] `src/model/model-token-limits.js` - 模型token限制配置

### 关键架构点验证
- [ ] 教学版threshold: SESSION_AUTO_COMPACT_MAX_TOKENS
- [ ] Token估算: 按消息文本长度粗略除以4
- [ ] Compact保留最近N条原始消息
- [ ] Summary作为synthetic system message插入
- [ ] Repeated compaction会合并旧summary
- [ ] Session在关键时机立即落盘
- [ ] Anthropic模式下summary进入system字段
- [ ] 区分context window和max output tokens

---

## Lesson 6: Streaming Runtime (06-streaming-runtime.md)

### 核心目标
- 实现Streaming Runtime
- 把SSE字节流解析成事件
- 流式组装text和tool_use
- 超时保护和自动回退

### 必须检查的文件
- [ ] `src/model/streaming-sse.js` - SSE字节流解析成事件
- [ ] `src/model/anthropic-messages-model.js` - 优先streaming，失败回退
- [ ] `src/core/agent-runtime.js` - 消费assistant events
- [ ] `src/index.js` - CLI打印流式事件

### 关键架构点验证
- [ ] Anthropic adapter默认请求stream: true
- [ ] SSE解析: ReadableStream -> 按\n\n切分 -> event/data解析
- [ ] 处理Anthropic事件: message_start/content_block_start/content_block_delta/content_block_stop/message_delta/message_stop
- [ ] text_delta持续拼接assistant文本
- [ ] input_json_delta持续拼接tool input JSON
- [ ] 网关不支持SSE时自动回退到response.json()
- [ ] Trace记录stream event
- [ ] LLM_REQUEST_TIMEOUT_MS控制超时
- [ ] CLI消费text_delta/tool_use/message_stop事件

---

## 通用检查项

### 架构一致性
- [ ] 代码目录结构与文档描述一致
- [ ] 文件命名符合约定
- [ ] 模块导出与文档描述一致

### 代码质量
- [ ] 错误处理完善
- [ ] 边界条件处理
- [ ] 日志记录适当

### 可测试性
- [ ] 关键逻辑可单元测试
- [ ] 依赖可mock
