# 第 9 课：事实型 Tool Signals

lesson9 的真正收敛结果，不是把 lesson8 的 continuation 继续做重，而是反过来把系统变轻。

这一课最终学到的不是：

- 如何再造一套更复杂的 policy engine

而是：

- 哪些信息应该由 tool 自己返回
- 哪些边界应该交给 runtime
- 哪些压力应该交给 compaction

当前 lesson9 的原则可以压成一句话：

- `Facts-first, guardrails-for-high-cost-boundaries`

## 这课解决的问题

lesson8 后期我们其实尝试过很多更重的路线：

- continuation 卡片
- `strategy`
- `policy`
- `preferred / disallowed`
- runtime follow / ignore 评估
- runtime steering
- 统一 `tool-result-budget`

这些尝试并不是没有价值，但它们共同暴露出一个问题：

- runtime 开始越来越像“策略解释器”

而这和我们想对齐的 Claude Code 气质不太一致。

更接近长期方向的形态应该是：

- tool 把事实讲清楚
- runtime 只负责编排和少量确定性边界
- 长上下文问题交给 compaction

## 当前 lesson9 的分层

### 1. Tool 层：返回事实信号

tool 现在主要返回：

- `truncated`
- `reason`
- `omitted*`
- `fileBytes / maxFileBytes`
- `returnCodeInterpretation`
- `returned* / total*`
- `durationMs / numFiles / filenames`

也就是说，tool 的职责是告诉模型：

- 这次只返回了多少
- 省略了多少
- 为什么省略
- 当前结果属于 partial result、large file、large output 还是正常结果

tool 不再默认返回：

- `strategy`
- `suggestedTool`
- `suggestedActions`
- 显式 continuation 卡片

### 2. Runtime 层：只做 orchestration

runtime 当前只负责：

- 调模型
- 调工具
- 记录 session
- 记录 usage
- 触发 compaction
- 在执行前跑最小 `PreToolUse` hook

runtime 不再负责：

- 解释 tool result 的下一步策略
- 给模型打 `follow / ignore`
- 注入 steering hint
- 在 tool execute 后再统一裁剪一遍结果

### 3. Guardrail 层：只保留高成本边界

当前明确保留的 deterministic guardrail 有两类：

- `read_file` 因大文件被拒后
- 不允许马上用 `bash` 对同一路径做 direct file dump
- 不允许用 `bash` 对 workspace 外路径做明显的探测或读取

这个边界之所以值得代码化，是因为它满足四个条件：

- 成本高
- 后果坏
- 很容易重复
- 很容易稳定判断

所以 lesson9 的一个重要结论是：

- 不是所有 continuation 都应该代码化
- 只有高成本、稳定、确定的边界才值得 guardrail 化

同时也要明确：

- 文件工具自己的 workspace boundary，不等于整套系统已经有了全局 sandbox
- 如果 shell 仍然比文件工具“更强”，runtime 就需要补最小但稳定的 deterministic policy

### 4. Compaction 层：负责长上下文压缩

lesson9 现在不再保留统一 `tool-result-budget` 写回层。

当前策略是：

- tool result 直接进入 session
- session 继续累积真实上下文
- 对话变长后，再由 compaction 统一压缩历史消息

这意味着 lesson9 现在明确区分了两类事：

- tool-native limits
  由 tool 自己决定怎么收小结果
- session-level compaction
  由 runtime 的 compaction 机制统一处理长对话历史

这比“每次 tool execute 后统一再裁一遍 write-back result”更接近 Claude Code 当前 built-in tool 的实现习惯。

## 当前工具语义

### `read_file`

当前 `read_file` 更像：

- 读取文件的一个 line window
- 返回 `type / file.filePath / file.content / file.startLine / file.numLines / file.totalLines`
- 使用单一 `READ_FILE_MAX_BYTES` 上限，默认对齐到 Claude Code 的 `10 MB`
- 文件超过这个上限时，不论 full read 还是 window read，都返回 `reason: "file_too_large"`
- 默认就是 window-first，裸 `read_file({ path })` 也只返回一个默认窗口
- 如果只传了 `offset` 没传 `limit`，会自动落到默认窗口大小

它还会在大文件场景下附带 enforcement 信息，供 runtime 后续生成最小 guardrail。

### `grep_search`

当前 `grep_search` 会返回：

- `mode`
- `numFiles`
- `filenames`
- `content`
- `numLines`
- `numMatches`
- `appliedLimit`
- `appliedOffset`

当前也已经开始向 Claude Code 的 `grep_search` 对齐，支持：

- `glob`
- `context`
- `-A / -B / -C`
- `-i`
- `-n`
- `type`
- `head_limit`
- `offset`
- `output_mode`
- `multiline`

重点是：

- 这是“搜索事实”
- 不是“搜索建议”
- `grep_text` 在 lesson9 里仍保留为兼容别名

### `list_files`

当前 `list_files` 会返回：

- `totalEntryCount`
- `returnedEntryCount`
- `omittedEntryCount`
- `truncated`

并且现在也和其他文件工具保持一致：

- 拒绝 workspace 外路径

但这里要注意一个 lesson9 里非常重要的边界：

- `list_files` 的 workspace 限制，是文件工具自己的 deterministic boundary
- 它不自动等于整个 agent 的全局 shell sandbox
- 如果 `bash` 执行层本身没有足够强的隔离，模型理论上仍可能从 shell 侧绕过去

语义也很简单：

- 告诉模型目录有多大
- 告诉模型当前只看到了多少

### `glob_search`

当前 `glob_search` 会返回：

- `durationMs`
- `numFiles`
- `filenames`
- `truncated`

语义也很简单：

- 告诉模型某个 glob pattern 命中了哪些文件
- 告诉模型当前是否只看到了前一部分命中结果

### `bash`

当前 `bash` 会返回：

- `stdout`
- `stderr`
- `interrupted`
- `returnCodeInterpretation`
- `noOutputExpected`
- `sandboxStatus`

其中 `sandboxStatus` 现在也更接近 Rust：

- `requested.allowed_mounts` 保留原始请求
- `allowed_mounts` 是相对 workspace 归一化后的结果
- `fallback_reason` 按 namespace / network / allow-list 规则推导

另外 lesson9 现在也不只是“回传 sandboxStatus”：

- foreground shell 会把 `HOME / TMPDIR` 真正切到 `.sandbox-home / .sandbox-tmp`
- Linux 且 `unshare` 可用时，会像 Rust 一样优先走 sandbox launcher

另外它还会在大文件直出场景下返回：

- `guard.reason = "file_too_large_for_direct_shell_dump"`

并配合本地 `PreToolUse` hook 做两类阻断：

- 阻止 `read_file` 大文件拒绝之后的 direct file dump follow-up
- 阻止明显的 workspace 外文件探测/读取，比如 `ls ../`、`cat /etc/hosts` 这类 shell 路径逃逸

## lesson9 为什么比之前更健康

这课最大的价值，不是“做了更多功能”，而是“删掉了不该在 runtime 里的功能”。

最终收敛后的 lesson9：

- 概念更少
- 职责更清楚
- 更容易扩展到未知工具
- 更容易和 Claude Code 当前 built-in tool 风格对齐

尤其是对未来工具扩展来说，这点很重要：

- 如果 tool 面会越来越大
- 那 runtime 越不应该理解 tool-specific continuation

tool 只需要把事实讲清楚，模型再结合 tool 的 `description` / `inputSchema` 自己决定下一步。

## lesson9 当前仍然存在的差距

虽然 lesson9 在语义风格上已经更接近 Claude Code，但功能深度仍然只是教学版。

最明确的差距有这些：

### 1. `read_file` 还不够像 line-window tool

当前已经开始向 line-window 读取靠拢，但还没有完全对齐 Claude Code。

当前已支持：

- `offset`
- `limit`
- `startLine`
- `totalLines`
- `numLines`
- 大文件 window read

但离 Claude Code 还差：

- 更稳定的文本/binary 分流
- 更明确的 envelope 结构
- 更完整的 workspace boundary 语义

### 2. `grep_search` 还没有完全贴齐 `grep_search`

当前已支持：

- regex
- `glob`
- context lines
- `offset`
- `head_limit`
- file type filter
- `output_mode`

但还差：

- 更完整的 multiline 语义
- 与 Claude Code 更接近的输出 envelope
- 更稳定的 regex/content mode 边界

### 3. `glob_search` 还只是第一版

当前已经补上了独立 `glob_search`，但它还只是第一版。

当前 `list_files + glob_search` 已经可以覆盖更多目录发现，但离 Claude Code 的成熟度仍有差距。

### 4. 编辑能力开始补齐，但还不够深

当前已经有：

- `write_file`
- `edit_file`
- `originalFile`
- `structuredPatch`
- workspace boundary guard
- binary / oversized file rejection
- `write_file` 的 create/update 输出契约

当前还不够的是：

- 更细粒度的 patch / hunk 质量
- 更强的 user-modified 检测
- 更接近平台能力的 `structured_patch` / `original_file` 工作流

### 5. `bash` 还不是平台级 shell tool

当前已经补上：

- `timeout`
- `run_in_background`
- `dangerouslyDisableSandbox`

当前还缺：

- sandbox / filesystem / network 选项

### 6. 平台型工具面还没有展开

当前还缺：

- `WebFetch`
- `WebSearch`
- `ToolSearch`
- `Skill`
- `Agent`
- MCP tools
- `LSP`
- `TodoWrite`
- `NotebookEdit`

## 这一课最终的 takeaway

lesson9 最后的结论可以直接记成四句：

1. tool 应该优先返回事实信号，而不是 continuation 卡片  
2. runtime 不应该扮演 tool 策略解释器  
3. 高成本、稳定可判断的边界才值得变成 guardrail  
4. tool result 原样进入 session，长上下文压缩交给 compaction

如果 lesson9 做对了，后面的课就不需要再围绕“如何让 runtime 替模型做更多策略判断”打转，而是可以回到更实在的主线：

- 把 tool 做深
- 把 permission / hook 做稳
- 把 compaction 和 session 管理做强
