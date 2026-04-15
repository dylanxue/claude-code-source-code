# Agent Study

重要：你的职责是结合自己的知识和当前工程下claude code的源码复刻，来一步步指导我学习开发一个coding agent，当遇到架构决策时，基本原则是参考claude code。

最重要的原则之一：

- 我们不是在做“教学 agent”，而是在用课程式拆解来实现一个顶级 agent
- 教学只是实现和讲解方式，不是产品定位
- 任何设计取舍都应优先服务真实 agent 能力，而不是为了课堂演示去弱化 runtime、状态模型或 orchestration
- 当“更好讲”和“更接近顶级 agent 架构”冲突时，优先选择后者，再想办法把它讲清楚

设计原则之二：

- 在可行前提下，无穷靠近 Claude Code 的实现
- 不只参考它的概念命名，更要尽量靠近它的 runtime 原语、状态模型、工具边界、生命周期和 orchestration 方式
- 如果某一课暂时不能直接做到 Claude Code 的复杂度，也应先保持接口、数据形状和演进方向一致，而不是为了局部简单引入会偏离主线的替代设计
- 只有在当前课的实现约束确实不允许直接贴近时，才接受阶段性偏离；一旦偏离，必须明确记录偏离原因和后续回收路径

这是一个按课程快照组织的 Node.js coding agent 学习项目。

每一课都保存为独立目录：

- `lesson1/`：第 1 课，最小可运行 coding agent
- `lesson2/`：第 2 课，工具层与多步 runtime
- `lesson3/`：第 3 课，真实 LLM adapter
- `lesson4/`：第 4 课，session persistence 与 resume
- `lesson5/`：第 5 课，session compaction 与 summary continuation
- `lesson6/`：第 6 课，streaming runtime foundations
- `lesson7/`：第 7 课，compaction hardening
- `lesson8/`：第 8 课，context budget controls
- `lesson9/`：第 9 课，factual tool signals
- `lesson10/`：第 10 课，runtime decision loop
- `lesson11/`：第 11 课，web search / web fetch
- `lesson12/`：第 12 课，tool search / capability discovery
- `lesson13/`：第 13 课，skill / reusable workflows

从 `lesson13` 开始，课程里也引入了自己的并列目录约定 `.dclaw/`，用来学习 `.claude / .codex` 这类本地 agent 目录形态，同时保留课程自己的演进空间。lesson13 起，运行时配置、日志和 session 持久化也开始逐步收进这个目录；未来发布成工具时，可以通过 `DCLAW_HOME=~/.dclaw` 切到用户 home 下的 agent home。

这样做有两个好处：

- 每一课都能回看，不会被后续修改覆盖
- 下一课总是基于上一课演进，学习路径更清晰

## 跨设备继续

如果你换电脑继续开发，先看：

- `HANDOFF.md`

它会记录当前做到哪一课、最新 lesson 的状态、配置依赖和下一步建议。

## 使用方式

运行第 1 课：

```bash
cd agent-study/lesson1
npm start -- "请阅读 ../rust/README.md 并总结它的架构"
```

运行第 2 课起点：

```bash
cd agent-study/lesson2
npm start -- "列出 src 目录下和 tool 相关的文件"
```

## 课程约定

后面每进入新的一课，我们都按这个流程推进：

1. 复制上一课目录为新的 `lessonN`
2. 只在新的课程目录里继续开发
3. 保留旧课内容不再覆盖
4. 课程表达可以循序渐进，但实现方向必须持续朝产品级 agent 收敛
5. 优先引入真实 runtime 原语、结构化状态和可观察 orchestration，而不是为了教学方便长期停留在 demo 级抽象
