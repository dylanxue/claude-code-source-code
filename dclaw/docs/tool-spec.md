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

当前基础接口已收口为：

```ts
interface Tool<I = unknown, O = unknown> {
  name: string
  description: string
  inputSchema: Record<string, unknown>
  outputSchema?: Record<string, unknown>
  call(input: I, ctx: ToolUseContext): Promise<ToolResult<O>>
  mapToolResult(result: ToolResult<O>): unknown
  validate(input: I, ctx: ToolUseContext): Promise<ValidationResult>
  isEnabled(ctx: ToolUseContext): boolean
  isReadOnly(input: I): boolean
}
```

并通过 `buildTool` 提供默认实现，避免调用侧散落 `?.` 分支。

## 4. ToolUseContext

当前最小上下文包含：

- `cwd`
- `readState`
- `permissionMode`
- `availableTools`
- `askUserQuestions`

## 5. ToolResult

建议结构：

```ts
type ToolResult<T> = {
  ok: boolean
  output: T
  summary?: string
}
```

消息层额外保留：

- 模型侧 `output`
- 内部 `rawOutput`

这样 transcript / trace 可以看到完整内部结果，而 provider 只消费映射后的模型侧结果。

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
  - 已完成第一轮向 Claude Code 的错误语义和输出形态收紧
  - `Read` 已补上 `isPartial / didReadToEnd / warning / endLine`
  - `Edit / Write` 已补上基础 `structuredPatch`
  - `Edit / Write` 已补上最小 `gitDiff`
  - `Write` 已补上 `create / update / noop`
  - `Edit / Write` 的 direct `call` 已拦截未完整读取与 stale read 覆盖
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
  - 已补上结果持久化元信息与 `sandboxMode` 可观测性
  - 已补上 `executionMode / stdoutTruncated / stderrTruncated / persistedOutputSize`
  - 已覆盖一批更细的重定向边界，包括 `fd duplication / force-clobber / >& file / &> / &>>`
  - 已将 command substitution / process substitution 移出只读自动放行路径
  - 当前可视为阶段 5 的基础收口已到位
  - 仍未接入真正的 sandbox、更细粒度权限规则和 AST 级 shell 解析；这部分暂时后置
- `Glob`
  - 已补上默认 100 条结果限制和 `truncated`
  - 已补上 `searchRoot / engine / durationMs / appliedLimit`
- `Grep`
  - 已补上默认 `head_limit=250`
  - 已支持 `0` 表示 unlimited
  - 已补上 `-A / -B / -C / context / -n / type / multiline` 的基础参数
  - 已补上 `totalFiles / totalMatches / searchRoot / engine / durationMs`
- `WebFetch / AskUserQuestion`
  - 已完成第一轮增强
  - `WebFetch` 已补上协议校验、跨 host 重定向提示、HTML/JSON 正文提取、按 prompt 聚焦的相关摘录与更丰富结果元信息
  - `AskUserQuestion` 已补上稳定 question id、唯一性校验、可选 preview/annotations 字段与答案规范化
  - 进一步向 Claude Code 靠拢的打磨项已后置到 `v0.2+ / 低优先级`

- Tool 协议层
  - 已补 `buildTool`
  - 已补显式 `outputSchema`
  - 已在 `queryLoop` 接入 `outputSchema` 运行时校验
  - 已将模型侧输出与内部输出分层

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
  -> outputSchema validation
  -> mapToolResult
  -> tool_result
```

## 10. 后续扩展

后续再接入：

- task tools
- MCP tools
- agent tools
- memory tools
