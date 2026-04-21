# Memory 系统设计

## 1. 目标

`dclaw` 的 memory 系统参考 Claude Code 的 `memdir` 设计，目标不是“把所有历史都塞进上下文”，而是：

- 用文件系统做长期记忆载体
- 用索引控制注入规模
- 用 relevance recall 做按需召回

## 2. 核心能力

### 2.1 file-based memory

memory 使用本地文件持久化。

建议路径：

```text
默认: ~/.dclaw/projects/<sanitized-workspace>/memory/
若设置 DCLAW_HOME: <DCLAW_HOME>/projects/<sanitized-workspace>/memory/
```

### 2.2 `MEMORY.md`

作用：

- 作为 memory 入口索引
- 不直接存全部正文
- 每条 memory 对应独立文件

### 2.3 memory 文件

每条 memory 用独立 markdown 文件保存，并带 frontmatter。

建议字段：

- `name`
- `description`
- `type`
- `updated_at`

### 2.4 relevance recall

在 query 时：

1. `MEMORY.md` 入口索引常驻注入 system prompt
2. 扫描 memory 文件头，生成 manifest
3. 使用 side-query 基于 query + manifest 选择与当前 query 最相关的少量 memory
4. 将选中的 memory 文件正文按上限注入上下文

### 2.5 当前实现状态

当前已完成：

- 已新增 `src/memory/paths.ts / frontmatter.ts / store.ts / manifest.ts / recall.ts`
- 已落地 memory 目录路径、`MEMORY.md` 入口、独立 memory markdown 文件
- 已落地最小 frontmatter 与 file-based manifest
- 已接通 `MEMORY.md` 常驻 system prompt
- 已接通 query-time recall / prompt 注入主链路
- 已将 recall 收口到 side-query 选择主路径
- 已明确 side-query selector 永远复用主对话的 `client/model`，不单独引入 selector model / routing
- 已将 turn-end automatic extraction 收口到非阻塞 / 后台写回主路径
- 已将 memory 写回边界收口到受限的 memory-only `Read / Edit / Write` 子工具链，不让 extraction 顺手读仓库或写出 memory 目录
- 已将写回去重 / 升级规则收口到 manifest 校验：覆盖同 type 下同名升级，以及“唯一相似描述”优先升级已有文件
- 已明确 `MEMORY.md` 只作为入口索引，不直接存整段 memory 正文
- 已明确成功写回只追加 transcript-only system note，不把 memory extraction 对话混回主对话 prompt

当前后置：

- team memory sync
- 更进一步的策略打磨与体验优化

## 3. memory 类型

首版建议沿用 Claude Code 同类思路：

- `user`
- `feedback`
- `project`
- `reference`

## 4. 边界规则

不应写入 memory 的信息：

- 仅当前会话有效的短期执行步骤
- 已在 `CLAUDE.md` 中稳定存在的项目指令
- 可从当前仓库直接推导出的代码事实
- `git history`、近期改动、谁改了什么
- debugging recipe、活动总结、PR 列表、transcript-like recap

这类信息更适合：

- plan
- task
- `CLAUDE.md`

补充边界：

- memory extraction 只分析最近新增的 model-visible conversation，不额外探索代码库
- 若用户要求“记住”，应优先提炼其中持久、非显然的事实
- 若用户要求“忘记”，应更新或删除对应 memory
- `MEMORY.md` 只做短索引项；正文必须留在独立 memory 文件

## 5. recall 上限

当前约束：

- 单次最多召回 5 条 memory
- `MEMORY.md` 单独常驻注入
- 相关 memory 选择遵循“manifest + side-query”主线，不继续堆本地 heuristic

## 6. team memory

后续阶段支持：

- repo 级 team memory
- 本地与远端同步
