# Lesson 14: Agent / Delegation Runtime

`lesson13` 解决的是：

- agent 如何显式加载本地可复用 workflow

继续往前走，就会遇到另一个更系统级的问题：

- 当任务已经大到不适合一个 agent 一口气自己做完时，怎么把子任务显式委托出去

这一课因此补上：

- `Agent`

## 这一课的设计目标

lesson14 不追求一上来就做完整的异步调度系统，而是先证明一条最小 delegation loop：

1. 主 agent 创建一个子 agent
2. 子 agent 在独立 session 里运行
3. 子 agent 只拿到对应角色允许的工具
4. 主 agent 收回压缩后的结果继续推理

## 当前实现

lesson14 新增了一个工具：

- `Agent`

输入：

- `description`
- `prompt`
- `subagent_type`
- `name`
- `model`

输出：

- `agentId`
- `name`
- `description`
- `subagentType`
- `status`
- `outputFile`
- `manifestFile`
- `sessionFile`
- `result`
- `error`

## 教学版当前支持的 subagent type

- `Explore`
  读代码、查事实、总结现状
- `Plan`
  组织步骤、假设和风险
- `general-purpose`
  承接有边界的实现任务
- `Verification`
  做验证、检查和测试

这版的重点是“角色边界 + 独立 runtime”。

因此 `Plan` 当前除了 role-specific prompt 外，也补上了最小可用的：

- `TodoWrite`
- `StructuredOutput`

这让 lesson14 的教学版已经能覆盖一条更真实的 planning loop：

1. 规划子 agent 写入当前 todo 状态
2. 规划子 agent 产出结构化计划结果
3. 主 agent 再消费这份压缩结果继续推进

## lesson14 的关键实现原则

### 1. Agent 不是普通 tool 包装

普通 tool 是单步调用。

`Agent` 则是：

- 创建子 runtime
- 用独立 session 跑一轮 agent loop
- 把结果和轨迹写进 `.dclaw/agents`

### 2. 复用现有 AgentRuntime

lesson14 不重新写第二套 loop。

子 agent 仍然复用已有：

- `AgentRuntime`
- `Session`
- `ToolRegistry`

只是在外面加了一层：

- `subagent-runner`

负责创建角色 prompt、独立 session 和受限工具面。

### 3. 先做同步版教学 Agent

当前 `Agent` 工具会在一次调用里同步跑完子 runtime，然后把结果一次性返回。

也就是说，这课先证明：

- 委托能成立
- 边界能成立
- 结果能回收

异步生命周期如 `send_input / wait / close` 留到后续课程再扩。

## 落盘约定

lesson14 在 `.dclaw/agents/<workspace_hash>/<agent_id>/` 下保存：

- `manifest.json`
- `output.md`
- `session.json`

这样主 agent 可以只拿压缩后的 `result` 继续推理，而人类仍然能回看完整 delegation 产物。

## 推荐实验

```bash
cd agent-study/lesson14
npm test
```

```bash
cd agent-study/lesson14
npm run smoke
```

```bash
cd agent-study/lesson14
npm start -- "如果任务明显适合分工，请使用 Agent 委托一个 Explore 子代理先阅读 README 并总结。"
```

## lesson14 的一句话总结

- 让 agent 不只会调用工具，还会把 bounded task 委托给受限角色的子 runtime。
