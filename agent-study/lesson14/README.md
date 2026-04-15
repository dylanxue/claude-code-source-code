# Lesson 14: Agent / Delegation Runtime

这一课承接 `lesson13`，但重点不再是继续扩 workflow 资产。

`lesson13` 已经补上了 `Skill`，接下来更像 Claude Code 的问题是：

- 当一个任务已经大到不适合单个 agent 一口气自己完成时，系统怎么显式分工

参考 Claude Code，这件事不该只靠 prompt 里“你可以并行思考”之类的软提示，而应该通过显式的 `Agent` 工具来做。

所以 `lesson14` 的主题是：

- `Agent`

## 当前目标

lesson14 主要做四件事：

1. 给主 agent 增加显式 delegation 入口
2. 为子 agent 建立独立 session / manifest / output 落盘
3. 按角色限制子 agent 的工具面
4. 让子 agent 的压缩结果能回到主 agent 的推理链里
5. 补最小可用的 worker-style lifecycle，让 prompt 交付不再和 worker boot 混在一起

## 当前实现

现在 lesson14 主要有两层 delegation 能力：

- `Agent`
  直接把一个 bounded task 委托给受限角色的后台子 runtime，并立刻返回 running manifest
- `WorkerCreate`
  创建一个显式 worker lane，先进入 `spawning`
- `WorkerGet`
  查询 worker 当前生命周期状态
- `WorkerAwaitReady`
  等待 worker 进入 `ready_for_prompt`
- `WorkerSendPrompt`
  在 worker ready 之后再正式发送 prompt，进入后台执行

当前支持 4 种 `subagent_type`：

- `Explore`
- `Plan`
- `general-purpose`
- `Verification`

这版已经不是同步 demo：

- `Agent` 会先返回 `running` manifest
- 后台 subagent 自行完成并更新 registry / manifest / output
- `Worker*` 工具把 boot-ready-send-prompt 这条链路显式化
- lesson14 现在已经有最小 worker 状态机：
  - `spawning`
  - `ready_for_prompt`
  - `running`
  - `finished`
  - `failed`

## 角色边界

lesson14 当前最重要的是角色边界，而不是调度花样。

因此：

- `Explore`
  偏只读调查和事实总结
- `Plan`
  偏步骤拆解、风险整理和实施建议
- `general-purpose`
  偏有边界的执行任务
- `Verification`
  偏验证、测试和结果核对

其中 `Plan` 这版在 role-specific prompt 基础上，也补上了最小可用的：

- `TodoWrite`
- `StructuredOutput`

也就是说，课程版 `Plan` 已经能把步骤草案写进结构化 todo 存储，并把计划结果通过显式结构化 payload 回给主链路。

## 落盘方式

lesson14 会把子 agent 的产物写到：

- `.dclaw/agents/<workspace_hash>/<agent_id>/manifest.json`
- `.dclaw/agents/<workspace_hash>/<agent_id>/output.md`
- `.dclaw/agents/<workspace_hash>/<agent_id>/session.json`

worker 控制面会把状态写到：

- `.dclaw/workers/<workspace_hash>/<worker_id>/manifest.json`
- `.dclaw/workers/<workspace_hash>/<worker_id>/worker-state.json`

这样主 agent 可以只消费压缩后的结果，人类仍然能追踪 delegation 轨迹。

## 当前课程口径

lesson14 的定位可以压成一句话：

- `Delegate bounded work to a role-scoped subagent runtime`

也就是：

- 能自己直接完成的任务，直接做
- 需要先找工具时，用 `ToolSearch`
- 需要先加载套路时，用 `Skill`
- 需要显式分工时，用 `Agent`
- 需要先握手确认 worker ready，再安全交付 prompt 时，用 `WorkerCreate -> WorkerAwaitReady -> WorkerSendPrompt`

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

```bash
cd agent-study/lesson14
npm start -- "如果这个任务需要显式 worker 生命周期，请使用 WorkerCreate、WorkerAwaitReady 和 WorkerSendPrompt 来驱动 delegation。"
```

## 当前判断标准

如果 lesson14 的方向是对的，应该看到这些结果：

- 主 agent 可以显式委托一个子 agent，而不是只靠单 agent 自己硬撑
- 子 agent 有独立 session 和产物落盘
- 不同 `subagent_type` 会拿到不同工具边界
- 主 agent 能消费 delegation 的压缩结果继续工作
- worker boot 是否 ready 已经是显式状态，而不是隐含在一次性 Agent 调用里

## 下一步候选

lesson14 之后，最自然的后续主题会更偏完整 orchestration：

- trust-gate / prompt misdelivery / restart / observe completion
- 更完整的 worker / lane 恢复控制面
- `MCP / ReadMcpResource`
