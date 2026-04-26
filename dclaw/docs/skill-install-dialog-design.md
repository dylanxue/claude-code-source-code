# 对话式 Skill 安装设计

## 0. 当前进度（2026-04-26）

当前已落地：

- [x] 新增 builtin skill：`install-skills`
- [x] 新增 `ListLoadedSkills` tool
- [x] 新增 `ReloadSkills` tool
- [x] `Skill` tool prompt 已补充“外部 skill 搜索/安装优先走 `install-skills`”的路由规则
- [x] runtime 已支持在当前会话中 reload `skillRegistry`
- [x] `install-skills` 已补充首版 provider-specific guidance
  - `skillhub`：明确 CLI-only + `--dir`
- [x] 单测已覆盖：
  - builtin `install-skills` 可加载
  - `ListLoadedSkills` 可稳定返回当前 runtime 已加载 skills
  - `ReloadSkills` 可刷新当前会话并立刻暴露新 skill

当前仍未落地：

- [ ] 基于真实 `skillhub` CLI 的安装 workflow
- [ ] provider 选择与来源策略
- [ ] 显式 `skills install / list / remove / upgrade` 命令
- [ ] 安装来源元数据索引

## 1. 目标

第一阶段先不提供显式的 `skills install` CLI 命令，也不自建完整的 skill installer。

当前目标只有一个：

- 让用户通过自然语言稳定完成 skill 的发现、必要时安装、并在当前会话里立即可用

典型用户输入包括：

- “安装一个 `agent-browser` skill”
- “先检查是否已安装 SkillHub 商店，若未安装，请只安装 CLI，然后安装 `agent-browser` 技能”

## 2. 非目标

本阶段明确不做：

- `skills install / list / remove / upgrade` 显式命令
- 自建 skill 包格式、下载器、版本管理器
- 完整的 SkillHub 安装与来源管理抽象
- 插件式 marketplace 管理 UI
- 自动安装 skill 自身依赖的软件包

## 3. 核心结论

### 3.1 先做对话式安装，不先做命令

当前最需要验证的是：

- 用户自然语言是否能稳定触发正确 workflow
- 外部商店 CLI 是否足够稳定
- 安装目录策略是否合理
- 安装后的 skill 是否能在当前会话立刻可见

因此第一阶段优先做：

- `install-skills` builtin skill
- `ReloadSkills` tool
- 少量 prompt 路由规则

而不是先做完整命令面。

### 3.2 `install-skills` 不是单纯“去商店搜索”

`install-skills` 的职责是：

- 本地优先的 skill 发现与安装 workflow

它必须先检查：

- 当前会话里已经加载的 skills

如果本地已经存在合适 skill：

- 不重复安装
- 直接转为使用已有 skill

只有本地没有时，才进入外部商店安装流程。

### 3.3 不把安装策略硬编码进 `Bash` prompt

外部 skill 安装目录规则属于：

- `dclaw` 的业务策略

不是：

- `Bash` 的通用执行规则

因此：

- `bashPrompt` 保持通用，不增加 skill 安装特例
- 所有安装规则都集中放进 `install-skills`

### 3.4 第一阶段继续复用现有工具

本阶段不新增完整安装器，只复用已有能力：

- `Skill`
- `WebFetch`
- `Bash`

只新增一个极小的辅助 tool：

- `ReloadSkills`

## 4. 用户心智

对用户来说，不需要学习新的安装命令。

用户可以直接说：

- “安装 `agent-browser`”
- “先检查 `skillhub`，没有就安装 CLI，再安装 `agent-browser`”

系统内部再决定：

- 本地是否已有
- 是否需要外部商店 CLI
- 该装到哪个目录
- 装完后如何 reload

## 5. 目录策略

安装目标由 `dclaw` 决定，不让模型自由猜。

### 5.1 workspace 安装

- `<cwd>/.dclaw/skills`

### 5.2 user 安装

- `~/.dclaw/skills`

### 5.3 默认规则

- 用户未特别说明时，默认安装到 `workspace`
- 用户明确说“全局安装 / 公共安装”时，安装到 `user`

### 5.4 强约束

外部商店安装时：

- 必须显式指定目标目录
- 不允许依赖商店 CLI 默认目录 `./skills`

## 6. `install-skills` 的标准流程

`install-skills` 应遵循以下固定 workflow。

### 6.1 第一步：检查本地 skill

先检查当前已加载的 `skillRegistry`：

- 名称是否精确命中
- 是否已有明显对应的 builtin / user / project skill

如果本地已有：

- 不进入外部安装流程
- 直接建议或调用现有 `Skill`

### 6.2 第二步：选择外部来源

仅在本地没有命中时，才继续：

- `skillhub`
- 后续更多来源

当前阶段先按用户明确提到的 provider 执行。

如果用户没有明确指定，可按后续策略补充默认顺序；本阶段先不强推自动 provider 决策。

### 6.3 第三步：检查商店 CLI

例如：

- `skillhub`

如果 CLI 未安装：

- 先通过 `WebFetch` 读取官方安装说明
- 再通过 `Bash` 执行安装

安装时只装 CLI，不默认装其它附加内容。

### 6.4 第四步：执行安装

安装 skill 时：

- 必须显式指定 `--dir`
- `workspace` 装到 `<cwd>/.dclaw/skills`
- `user` 装到 `~/.dclaw/skills`

### 6.5 第五步：刷新当前会话

安装完成后必须调用：

- `ReloadSkills`

这样新装好的 skill 才能在当前会话中立即可见。

### 6.6 第六步：继续使用 skill

reload 成功后：

- 如需要，可继续调用 `Skill`
- 或继续完成用户原始任务

## 7. 典型示例

用户输入：

> 请先检查是否已安装 SkillHub 商店，若未安装，请根据 https://skillhub.cn/install/skillhub.md 安装 Skillhub 商店，但是只安装 CLI，然后安装 agent-browser 技能。若已安装，则直接安装 agent-browser 技能。

理想执行链：

1. `Skill(skill_name="install-skills")`
2. `install-skills` 检查本地是否已有 `agent-browser`
3. 若本地没有：
   - 检查 `skillhub`
   - `WebFetch("https://skillhub.cn/install/skillhub.md", ...)`
   - `Bash("curl ... | bash -s -- --cli-only")`
   - `Bash("skillhub install agent-browser --dir .dclaw/skills")`
4. `ReloadSkills`
5. 如后续任务需要，再使用 `Skill(skill_name="agent-browser")`

## 8. 为什么需要 `ReloadSkills`

当前 `skillRegistry` 是在 runtime 初始化时加载的。

如果 agent 通过 `Bash` 在会话中新增了 skill 文件：

- 当前会话不会自动看到这些新增 skill

因此必须补一个轻量的刷新入口：

- 重新扫描 builtin / user / project skills
- 重建 `skillRegistry`
- 更新当前会话与 subagent 共享上下文中的 registry

## 9. 需要改动的文件

### 9.1 新增

- `src/skills/builtin/install-skills/SKILL.md`
- `src/tools/builtin/reloadSkills.ts`

### 9.2 修改

- `src/tools/builtin/skillPrompt.ts`
- `src/tools/index.ts`
- `src/types/tool.ts`
- `src/cli/runtime.ts`

如后续需要补当前会话内刷新后的可观察性，也可继续扩展：

- `src/cli/replCommands.ts`
- `src/cli/interactive.ts`
- `src/cli/resume.ts`

## 10. 代码设计

### 10.1 `install-skills` skill

这份 skill 应该集中写清楚：

- 始终先检查本地 skills
- 本地已有就直接使用，不重复安装
- 外部安装前先检查商店 CLI
- CLI 未安装时，只安装 CLI
- 安装 skill 时必须显式指定目录
- 默认目录规则
- 安装后必须 `ReloadSkills`
- reload 成功后再使用新 skill

### 10.2 `Skill` tool prompt

只增加一条路由规则：

- 当用户表达“搜索/安装外部 skill”意图时，优先调用 `install-skills`

不要在 `Skill` tool prompt 中塞入安装细节。

### 10.3 `ReloadSkills` tool

建议做成一个极小工具：

- 无输入或仅保留最小输入
- 重新调用 `loadSkills({ cwd })`
- 重建 `createSkillRegistry(...)`
- 替换当前 `ToolContext.skillRegistry`
- 同步替换 `agentRuntime.skillRegistry`

输出至少包含：

- reload 是否成功
- 当前 skill 总数
- 新增/更新的 skill 名称（如果容易拿到）

### 10.4 `ToolContext`

建议新增：

```ts
reloadSkills?: () => Promise<{
  reloaded: boolean
  totalSkills: number
  skillNames: string[]
}>
```

## 11. 测试建议

### 11.1 skill loader

- `install-skills` 能作为 builtin skill 被加载

### 11.2 skill tool

- `Skill` tool 能正确应用 `install-skills`

### 11.3 reload

新增测试建议：

- 在临时目录写入一个新 skill 到 `.dclaw/skills`
- 调用 `ReloadSkills`
- 验证当前会话能立刻识别该 skill

### 11.4 安装 workflow

第一阶段不需要真的联网安装商店 skill，但至少要覆盖：

- 本地已有 skill 时不触发外部安装
- 本地无 skill 时，workflow 会要求走外部 CLI + 显式目录

## 12. 当前边界

本阶段的边界很重要：

- 只解决“通过对话把 skill 安装这件事处理好”
- 不解决完整的 skill store 命令面
- 不解决版本管理
- 不解决升级/卸载
- 不解决自动依赖安装

## 13. 后续阶段

后续可继续扩展为：

1. 通用的外部 skill provider adapter
   - `skillhub`
   - 其他来源
2. 显式命令面
   - `skills install`
   - `skills list`
   - `skills remove`
   - `skills upgrade`
3. 更强的本地 skill 推荐 / 路由能力
4. 更完整的安装来源元数据与索引

## 14. 当前决议

基于当前讨论，第一阶段正式采用以下方案：

- 不做 `skills install` 命令
- 不改 `bashPrompt`
- 新增 builtin skill：`install-skills`
- 新增轻量 tool：`ReloadSkills`
- 所有安装策略都集中写在 `install-skills`
- 外部安装必须显式写入：
  - `<cwd>/.dclaw/skills`
  - `~/.dclaw/skills`
- 安装完成后必须 `ReloadSkills`
