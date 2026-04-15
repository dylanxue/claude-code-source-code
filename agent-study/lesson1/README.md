# Lesson 1: Minimal Agent

这是一个用于学习 coding agent 架构的 Node.js 教学项目。

我们会参考当前工程里 Claude Code 的设计思路，但不直接照搬复杂实现，而是按学习顺序逐步复刻：

1. `bootstrap` 启动装配
2. `tool registry` 工具注册
3. `session` 会话状态
4. `agent runtime` 模型循环
5. `cli entry` 命令入口
6. 真正接入大模型
7. 权限系统、子 agent、记忆、压缩

## 当前阶段

当前实现的是第 1 课：最小可运行 coding agent。

它已经具备：

- 命令行入口
- 会话消息存储
- 工具注册与执行
- 基于规则的 mock planner
- 典型的 agent loop：模型决定动作 -> 调工具 -> 再让模型继续 -> 输出最终答案

## 目录结构

```txt
lesson1/
├── src/
│   ├── bootstrap/
│   │   └── create-agent-app.js
│   ├── core/
│   │   ├── agent-runtime.js
│   │   ├── session.js
│   │   └── tool-registry.js
│   ├── model/
│   │   └── mock-model.js
│   ├── tools/
│   │   ├── final-answer.js
│   │   ├── list-files.js
│   │   └── read-file.js
│   ├── index.js
│   └── lesson-notes.js
└── README.md
```

## 运行

在仓库根目录执行：

```bash
cd agent-study/lesson1
npm start -- "请阅读 rust/README.md 并总结它的架构"
```

也可以：

```bash
cd agent-study/lesson1
npm start -- "列出 src 目录下和 tool 相关的文件"
```

## 这个版本重点学什么

先抓住 Claude Code / Claw Code 最核心的抽象：

- `tool_pool.py` 对应这里的 `ToolRegistry`
- `bootstrap_graph.py` 对应这里的 `createAgentApp()`
- `conversation.rs` 对应这里的 `AgentRuntime`
- `session.rs` 对应这里的 `Session`

## 下一步建议

下一阶段可以继续做：

1. 把 `MockModel` 换成真正的 LLM provider
2. 增加 `write_file`、`grep`、`bash` 工具
3. 增加权限拦截层
4. 增加 system prompt 与工具 schema
5. 增加 session 持久化
