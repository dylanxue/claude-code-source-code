# .dclaw

`lesson13` 引入了一个教学用的 `.dclaw/` 目录，作用是把我们自己的本地约定收成和 `.claude/`、`.codex/` 类似的形态。

当前 lesson13 会识别这些位置：

- `logs/<workspace_hash>/`
- `sessions/<workspace_hash>/`
- `.env.local`
- `.dclaw/skills/<name>/SKILL.md`
- `.dclaw/commands/<name>.md`
- `skills/<name>/SKILL.md`
- `commands/<name>.md`

也就是说，从 lesson13 开始，agent 运行过程中的配置、日志、session 持久化和本地 skill/command 资产，都开始收口到 `.dclaw/`。

当前默认行为：

- 开发时：`<workspace>/.dclaw/`
- 发布后：如果设置 `DCLAW_HOME=~/.dclaw`，就会整体切到用户 home 下的 `.dclaw/`

其中 session 和 logs 会进一步按 workspace hash 分片，方向参考 `claw-code` 的 `.claw/sessions/<workspace_hash>/`。

这样做的目标不是替代 `.claude` 或 `.codex`，而是给课程保留一个我们可以自由演进的并列 agent home 目录。
