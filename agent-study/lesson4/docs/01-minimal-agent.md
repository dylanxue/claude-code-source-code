# 第 1 课：最小可运行 Coding Agent

这一课只做一件事：理解一个 coding agent 的最小闭环。

## 我们复刻了什么

参考了当前仓库里的这些设计：

- `src/tool_pool.py`
- `src/command_graph.py`
- `src/bootstrap_graph.py`
- `rust/crates/runtime/src/conversation.rs`
- `rust/crates/runtime/src/session.rs`

但我们先只保留最核心的运行机制：

```txt
用户输入
  -> runtime 收到任务
  -> model 决策下一步
  -> tool registry 找到工具
  -> tool 执行
  -> tool result 写回 session
  -> model 继续决策
  -> 最终回答
```

## 对应代码

- `src/index.js`
  命令行入口，负责接收用户 prompt。
- `src/bootstrap/create-agent-app.js`
  负责装配 session、model、tool registry、runtime。
- `src/core/agent-runtime.js`
  整个 agent 的循环核心。
- `src/core/session.js`
  保存 user / assistant / tool 消息。
- `src/core/tool-registry.js`
  统一注册和执行工具。
- `src/model/mock-model.js`
  一个简化版“模型决策器”。
- `src/tools/*.js`
  具体工具实现。

## 这一课最重要的理解

### 1. Agent 不等于 LLM

很多人刚开始学 agent，会把它理解成“调用一次模型 API”。

其实不是。

agent 至少包含：

- 状态
- 决策
- 工具
- 循环

LLM 只是“决策器”之一。

### 2. Tool registry 是稳定扩展点

如果没有统一的工具注册层，后面工具一多，调用关系会迅速失控。

所以我们先做 `ToolRegistry`，后面加 `bash`、`grep`、`write_file`、`web_search` 时都走同一个入口。

### 3. Session 是后续高级能力的地基

Claude Code 这类系统为什么能做：

- 连续多轮推理
- session resume
- summary compaction
- sub-agent 协作

本质都依赖会话状态被结构化保存。

## 自己跑一遍

```bash
cd agent-study
npm start -- "列出 src 目录下和 tool 相关的文件"
```

```bash
cd agent-study
npm start -- "请阅读 ../rust/README.md 并总结它的架构"
```

## 下一课建议

第 2 课我建议我们做这三件事：

1. 给工具加输入 schema
2. 新增 `write_file` 与 `grep` 工具
3. 把 `MockModel` 替换成真实 LLM adapter
