# Lesson 9: Factual Tool Signals

这一课承接 `lesson8`，但目标已经明显收敛。

`lesson8` 的重点是：

- 控制超大 tool output 如何进入上下文
- 验证 continuation / policy / runtime steering 这些思路

走到 `lesson9`，我们最终收敛出的方向是：

- `Facts-first, guardrails-for-high-cost-boundaries`

也就是：

- tool 优先返回“发生了什么”的事实信号
- runtime 不替模型写下一步策略
- 只有极少数高成本边界，才用 deterministic guardrail 兜底

## 当前目标

lesson9 现在主要做三件事：

1. 让 tool 返回事实型结果，而不是 continuation 卡片
2. 让 runtime 更像 orchestration，而不是策略解释器
3. 让 tool result 直接进入 session，由 compaction 负责后续压缩

## 当前实现

现在 lesson9 的核心形态是：

- tool 自己做必要的专项截断或限流
- tool 返回 `truncated / omitted* / reason / fileBytes / maxFileBytes / returnCodeInterpretation` 这类事实字段
- runtime 原样记录 tool result，不再解析 continuation
- runtime 只维护一个最小的本地 `PreToolUse` guardrail
- tool result 写回 session 后，后续上下文收缩交给 compaction

当前 lesson9 不再包含这些东西：

- 统一 `tool-result-budget` 写回层
- `strategy -> policy`
- `preferred / disallowed`
- runtime `follow / ignore` 评估
- runtime steering hint

## 当前 tool 面

lesson9 当前保留的是一组最小核心工具：

- `list_files`
- `glob_search`
- `read_file`
- `grep_search`
- `write_file`
- `edit_file`
- `bash`

这些工具已经开始向 Claude Code 的 built-in tool 语义靠拢：

- `read_file`
  返回 `type / file.filePath / file.content / file.startLine / file.numLines / file.totalLines`
  使用单一 `READ_FILE_MAX_BYTES` 上限，默认对齐到 Claude Code 的 `10 MB`
  默认就是 window-first，裸 `read_file({ path })` 也只读一个默认窗口
  `offset` without `limit` 同样会落到默认窗口大小
- `grep_search`
  返回 `mode / numFiles / filenames / content / numLines / numMatches / appliedLimit / appliedOffset`
  这是 lesson9 里对齐 Claude Code 的正式搜索工具名，并支持 `-A / -B / -C / -i / -n / type` 这组 Rust 风格输入
  `grep_text` 仍保留为兼容别名
- `write_file`
  返回 `type / filePath / content / structuredPatch / originalFile`
  create/update 语义与 Claude Code 的 `file_ops::write_file` 对齐，并拒绝超大写入和 workspace 外路径
- `edit_file`
  返回 `oldString / newString / originalFile / structuredPatch / replaceAll / userModified / gitDiff`
  并拒绝 workspace 外路径、binary 文件和超出编辑上限的大文件
- `list_files`
  返回 `totalEntryCount / returnedEntryCount / omittedEntryCount / truncated`
  现在也和其他文件工具一样拒绝 workspace 外路径
  但这只是文件工具自己的 deterministic boundary，不等于整个 agent 的全局 shell sandbox
- `glob_search`
  返回 `durationMs / numFiles / filenames / truncated`
- `bash`
  返回 `stdout / stderr / interrupted / returnCodeInterpretation / noOutputExpected / sandboxStatus`
  输入和输出命名开始向 Claude Code Rust `bash` 对齐：`timeout / run_in_background / dangerouslyDisableSandbox`
  `sandboxStatus` 现在会像 Rust 一样区分 `requested.allowed_mounts` 和归一化后的 `allowed_mounts`
  现在也会像 Rust 一样把 `HOME / TMPDIR` 接到 `.sandbox-home / .sandbox-tmp`，并在 Linux + `unshare` 可用时真正走 sandbox launcher
  同时支持通过 `.env.local` / env 提供默认 sandbox 配置，再由 tool input 做 override

这条路的重点不是“给模型建议”，而是：

- 明确告诉模型这次 tool 调用到底发生了什么

## 最小 guardrail

当前保留的 deterministic guardrail 有两类：

- `read_file` 因大文件被拒后
- 如果下一轮又尝试用 `bash` 对同一路径做 direct file dump
- runtime 会在 `PreToolUse` 阶段阻断
- 如果 `bash` 明显在探测或读取 workspace 外路径
- runtime 也会在 `PreToolUse` 阶段阻断

这一层已经单独抽成：

- [pre-tool-use-hooks.js](/Users/ke.xue/work/claude-code-source-code/agent-study/lesson9/src/core/pre-tool-use-hooks.js)

目前覆盖的 direct file dump 形式包括：

- `cat`
- `head`
- `tail`
- `sed -n`
- `node -e readFileSync(...)`
- 少数等价的 compound shell 形式

另外，lesson9 现在也明确承认一个边界：

- `list_files / read_file / write_file / edit_file / glob_search / grep_search` 的 workspace 限制，是文件工具自己的本地约束
- 它们不自动等于整个 agent 的“全局安全边界”
- 如果 `bash` 所在执行层没有足够强的 sandbox，shell 仍可能成为更强的逃逸口
- 所以 lesson9 额外用 deterministic `PreToolUse` hook 拦住“明显的 workspace 外文件探测/读取”

## 为什么移除了统一 tool-result-budget

lesson9 当前参考 Claude Code 的方向，做了一个关键收敛：

- 不再在 runtime 里统一裁一遍 tool result

当前更强调：

- tool 自己决定返回什么结构
- session 原样保留 tool result
- 长对话压力由 compaction 统一处理

这比“每次 tool execute 后再写回前统一裁剪”更接近 Claude Code 当前 built-in tool 的习惯：

- tool-native limits
- session-level compaction
- runtime 不额外扮演 write-back budget allocator

## 推荐实验

```bash
cd agent-study/lesson9
npm run smoke
```

```bash
cd agent-study/lesson9
npm start -- "解释 lesson9 现在为什么更接近 Claude Code 的 tool 输出语义"
```

```bash
cd agent-study/lesson9
READ_FILE_MAX_BYTES=100 npm start -- "读取 src/tools/grep-text.js 并总结它做了什么"
```

## 当前判断标准

如果 lesson9 的方向是对的，应该看到这些结果：

- 新工具默认只需要返回事实型字段，不需要 continuation schema
- runtime 不需要解析 tool result 里的下一步策略
- tool result 直接进入 session
- 只有极少数高成本边界需要 guardrail
- lesson9 比 lesson8 后期那套 policy / continuation engine 更轻，也更接近 Claude Code

## 当前最明确的后续待办

虽然语义风格已经更接近 Claude Code，但 tool 功能深度仍然明显不够。后续最值得补的是：

- `read_file`
  继续补齐并打磨 `offset / limit / startLine / totalLines / numLines`
- `grep_search`
  继续补齐并打磨更像 `grep_search` 的接口：当前已支持 `glob / context / -A / -B / -C / -i / -n / type / offset / head_limit / output_mode / multiline`
- 继续打磨独立 `glob_search`
- 继续打磨 `bash`，尤其是 sandbox / filesystem / network 选项
- 后续再逐步补 `WebFetch / WebSearch / ToolSearch / Skill / Agent / MCP / LSP / TodoWrite / NotebookEdit`
