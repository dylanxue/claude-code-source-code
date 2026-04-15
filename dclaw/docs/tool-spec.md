# Tool 协议设计

## 1. 目标

建立一个与 Claude Code `Tool.ts` 思路一致的统一工具协议。

## 2. 设计原则

1. 所有工具共享一套 contract
2. tool 输入必须 schema 化
3. tool 输出必须标准化
4. tool 执行必须接入 permission
5. tool 可选支持摘要、渲染、进度、校验

## 3. 基础接口

建议基础接口：

```ts
interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  call(input: I, ctx: ToolUseContext): Promise<ToolResult<O>>
  validate?(input: I, ctx: ToolUseContext): Promise<ValidationResult>
  isEnabled?(ctx: ToolUseContext): boolean
  isReadOnly?(input: I): boolean
}
```

## 4. ToolUseContext

建议包含：

- `cwd`
- `readState`
- `abortController`
- `getAppState`
- `setAppState`
- `sessionId`
- `permissionMode`
- `availableTools`

## 5. ToolResult

建议结构：

```ts
type ToolResult<T> = {
  ok: boolean
  output: T
  summary?: string
  metadata?: Record<string, unknown>
}
```

## 6. MVP 工具集合

- `Read`
- `Edit`
- `Write`
- `Glob`
- `Grep`
- `Bash`
- `WebFetch`
- `AskUserQuestion`

## 7. 当前对齐进展

- `Read / Edit / Write`
  - 已有基础的读后写约束
  - 已开始向 Claude Code 的错误语义和输出形态收紧
  - `Read` 已补上 `isPartial`
  - `Read` 已补上空文件 / offset 越界 warning
  - `Edit / Write` 已补上基础 `structuredPatch`
  - `Edit / Write` 已补上最小 `gitDiff`
- `Bash`
  - 已有最小 timeout、`interrupted`、`noOutputExpected` 和只读判定
  - 已补上最小 `run_in_background`
  - 已补上大输出 `persistedOutputPath`
  - 已接入最小 `permissionMode` 入口和 `dangerouslyDisableSandbox` 模式约束
  - 已接入最小 permission evaluator
  - 已开始识别 `timeout / time / nice / stdbuf / nohup` 这类安全 wrapper
  - 已开始识别一小组 Claude Code 风格的安全环境变量前缀
  - 已将带输出重定向的命令从只读自动放行中排除
  - 已为动态重定向目标和 `cd` + 重定向组合命令补上人工审批原因
  - 仍未接入真正的 sandbox、更细粒度权限规则和更完整的结果持久化语义
- `Glob`
  - 已补上默认 100 条结果限制和 `truncated`
- `Grep`
  - 已补上默认 `head_limit=250`
  - 已支持 `0` 表示 unlimited
  - 已补上 `-A / -B / -C / context / -n / type / multiline` 的基础参数
- `WebFetch / AskUserQuestion`
  - 仍处于最小实现阶段

## 8. 当前 permission mode 语义

- `default`
  - 只读工具自动放行
  - 变更型工具尝试走交互审批
- `accept-edits`
  - `Edit / Write` 自动放行
  - 其他变更型工具尝试走交互审批
- `plan`
  - 仅放行只读工具
- `bypass-permissions`
  - 放行所有工具

## 9. 工具执行链路

```text
tool_use
  -> registry lookup
  -> enabled check
  -> validate
  -> permission evaluation
  -> call
  -> tool_result
```

## 10. 后续扩展

后续再接入：

- task tools
- MCP tools
- agent tools
- memory tools
