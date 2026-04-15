# Lesson 13: Skill / Reusable Workflows

这一课承接 `lesson12`，但重点不再是继续做能力发现。

`lesson12` 已经补上了 `ToolSearch`，接下来更像 Claude Code 的问题是：

- 当某类任务已经有稳定套路时，agent 为什么还要每次临时现编？

参考 Claude Code，这件事应该通过 `Skill` 来解决。也就是把本地可复用工作流、约定和操作步骤收成显式 prompt 资产，而不是永远只靠系统 prompt 和临场推理。

所以 `lesson13` 的主题是：

- `Skill`

## 当前目标

lesson13 主要做三件事：

1. 给 agent 增加显式的可复用工作流入口
2. 按 Claude Code 风格实现本地 skill 查找链路
3. 让 `ToolSearch -> Skill` 这条能力发现到能力加载的链路开始成形

## 当前实现

现在 lesson13 新增了一个工具：

- `Skill`
  从本地 skills / commands 目录解析并加载 `SKILL.md` 或兼容 markdown 文件

它主要参考：

- `rust/crates/tools/src/lib.rs`

当前返回 shape 也尽量贴近 Rust：

- `skill`
- `path`
- `args`
- `description`
- `prompt`

## 查找规则

lesson13 现在会按 Claude Code 的思路查这些位置：

- 当前项目及其祖先目录下的：
  - `.omc/skills`
  - `.agents/skills`
  - `.claw/skills`
  - `.codex/skills`
  - `.claude/skills`
  - `.dclaw/skills`
- 对应的兼容 commands 目录
- `CODEX_HOME`
- `DCLAW_HOME`
- `CLAW_CONFIG_HOME`
- `HOME` 下的常见 skills 目录
- `CLAUDE_CONFIG_DIR` 下的 skills / commands 目录

也就是说，这一课做的不是“读一个固定文件”，而是把 skill lookup 本身做成了系统能力。

另外，lesson13 也开始支持课程自己的并列目录：

- `.dclaw/logs`
- `.dclaw/sessions`
- `.dclaw/.env.local`
- `.dclaw/skills`
- `.dclaw/commands`

它的作用是让我们在学习 `.claude / .codex` 目录模式的同时，保留一个自己的可演进入口。

当前 lesson13 会把运行时配置和产物也一起收进这里：

- trace / summary / cli logs -> `.dclaw/logs/<workspace_hash>`
- sessions -> `.dclaw/sessions/<workspace_hash>`
- local env -> `.dclaw/.env.local`

如果以后发布成全局工具，可以通过 `DCLAW_HOME=~/.dclaw` 把整套 agent home 放到用户目录下。

## 为什么这一步重要

到这一步，agent 已经有：

- 文件工具
- shell 工具
- web 工具
- tool discovery

但如果没有 Skill，它遇到重复型任务时还是会每次重新组织流程。

lesson13 补的是：

- 让可复用 workflow 也进入工具面

这样后面的系统分层会更清楚：

- ToolSearch：先发现能力
- Skill：再加载套路
- Tool：最后执行具体动作

## Workspace Boundary Override

lesson13 目前默认还是保留教学版的 workspace boundary：

- 文件工具默认只允许读写当前 workspace 内路径
- `bash` 的 pre-tool guard 默认也会拦明显的 workspace 外路径探测

如果你想先放开这层限制，可以在 `.env.local` 里加：

```bash
TOOLS_IGNORE_WORKSPACE_BOUNDARY=true
```

这样 `read_file / write_file / edit_file / list_files / glob_search / grep_search` 会一起跳过 workspace boundary 检查，`bash` 那条“明显 workspace escape” guard 也会一起关闭。

这一步是 lesson13 的教学配置开关，不是 Claude Code 当前默认行为。

## 当前课程口径

lesson13 的定位可以压成一句话：

- `Load reusable workflows instead of re-inventing them each turn`

也就是：

- 问题明确、工具明确时，直接执行
- 工具不明确时，先 `ToolSearch`
- 已知有稳定流程时，再 `Skill`

## 推荐实验

```bash
cd agent-study/lesson13
npm test
```

```bash
cd agent-study/lesson13
npm run smoke
```

```bash
cd agent-study/lesson13
npm start -- "请加载 review skill"
```

## 当前判断标准

如果 lesson13 的方向是对的，应该看到这些结果：

- agent 可以显式加载本地 Skill，而不是只靠 prompt 和记忆
- 项目级 `.codex/skills` 和兼容 commands 目录都能被解析
- `Skill` 的输出不只是路径，还包含 description 和完整 prompt
- lesson12 的 `ToolSearch` 能自然把 `Skill` 视为一个可发现能力

## 下一步候选

lesson13 之后，最自然的后续主题有两条：

- `Agent`
- `MCP / ReadMcpResource`

但在进入下一课之前，lesson13 先把 “agent 如何加载本地可复用工作流” 这件事补上了。
