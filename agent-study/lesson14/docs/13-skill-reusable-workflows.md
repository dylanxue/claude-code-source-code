# Lesson 13: Skill / Reusable Workflows

`lesson12` 解决的是：

- 当工具面越来越大时，agent 怎么发现自己会什么

但再往前走一步，就会遇到另一个很实际的问题：

- 当某类任务已经有稳定套路时，agent 怎么复用这套套路

参考 Claude Code，这件事不该继续塞进系统 prompt，也不该让模型每次临场重建，而应该通过显式的 `Skill` 工具来完成。

## 参考来源

这课主要参考：

- `rust/crates/tools/src/lib.rs`

特别是 Rust 侧的：

- `SkillInput`
- `SkillOutput`
- `execute_skill`
- `resolve_skill_path`

以及 skills / commands 的兼容查找逻辑。

## lesson13 的设计结论

这一课最终想固定的是一条新的能力组织原则：

- 可复用 workflow 也应该是显式资产

也就是：

- 不把所有操作套路都埋在 prompt 里
- 不让模型每次临场现编
- 而是允许它按名称加载本地 Skill

## 当前实现

lesson13 新增：

- `Skill`

输入：

- `skill`
- `args`

输出：

- `skill`
- `path`
- `args`
- `description`
- `prompt`

当前实现会按 Claude Code 风格依次查找：

- 项目及祖先目录下的 skills / commands
- `CODEX_HOME`
- `DCLAW_HOME`
- `CLAW_CONFIG_HOME`
- `HOME`
- `CLAUDE_CONFIG_DIR`

并同时兼容两类形态：

- `skills/<name>/SKILL.md`
- `commands/<name>.md` 或兼容 markdown

另外，这一课也正式引入了课程自己的并列目录约定：

- `.dclaw/logs`
- `.dclaw/sessions`
- `.dclaw/.env.local`
- `.dclaw/skills`
- `.dclaw/commands`

这部分不是 Claude Code 现状，而是 lesson13 在学习 `.claude / .codex` 目录形态后，为课程自己保留的演进入口。

并且从这一课开始，运行时落盘也开始收进 `.dclaw/`：

- logs（按 workspace hash 隔离）
- sessions（按 workspace hash 隔离）
- local env

默认开发模式下使用 `<workspace>/.dclaw/`；如果未来发布为全局工具，则可以通过 `DCLAW_HOME=~/.dclaw` 切到用户 home。

## 和前几课的关系

lesson11 的重点是：

- explicit external-knowledge tools

lesson12 的重点是：

- explicit capability discovery

lesson13 则补上：

- explicit reusable workflows

这三课连起来，agent 的能力面会更完整：

1. 外部知识怎么拿
2. 工具怎么发现
3. 工作流怎么复用

## 验证方式

```bash
cd agent-study/lesson13
npm test
```

```bash
cd agent-study/lesson13
npm run smoke
```

## lesson13 的一句话总结

- 让本地 workflow 像工具一样被显式加载，而不是每轮都重新发明流程。
