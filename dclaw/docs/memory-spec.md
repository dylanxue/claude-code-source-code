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

1. 扫描 memory 文件头
2. 生成 manifest
3. 选择与当前 query 最相关的少量 memory
4. 注入上下文

### 2.5 当前实现状态

当前已完成 `阶段 10-1`：

- 已新增 `src/memory/paths.ts / frontmatter.ts / store.ts / manifest.ts / recall.ts`
- 已落地 memory 目录路径、`MEMORY.md` 入口、独立 memory markdown 文件
- 已落地最小 frontmatter 与 file-based manifest
- 已提供 deterministic `recall` helper，供后续 `10-2` 接入 query-time recall / prompt 注入

当前尚未完成：

- query-time prompt 注入
- 自动/手动写回策略收口
- team memory sync

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

这类信息更适合：

- plan
- task
- todo
- `CLAUDE.md`

## 5. recall 上限

首版建议：

- 单次最多召回 5 条 memory
- 优先使用 frontmatter + 描述筛选

## 6. team memory

后续阶段支持：

- repo 级 team memory
- 本地与远端同步
