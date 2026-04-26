# 多模态运行时与文档处理设计

相关文档：

- [多模态运行时实施计划](./multimodal-runtime-implementation-plan.md)
- [多模态输入任务清单](./multimodal-input-todo.md)

## 1. 目标

为 `dclaw` 设计一套可持续扩展的多模态输入与文档处理架构，支持当前最核心的：

- 文本输入
- 图片输入
- 文档输入中的 `pdf / docx / xlsx`

同时保证以下几点：

- 能适配不同模型/平台输入能力差异
- 能在必要时通过模型组合完成能力补齐
- 明确 `Read / WebFetch` 的边界，避免工具语义污染
- 为后续开发、测试、里程碑跟踪提供统一文档

当前讨论范围严格限定为：

- 只关注 `text + image + document`
- 暂不展开音频、视频、实时流式、OCR 平台能力统一抽象
- 先聚焦 CLI / agent 内部架构，不讨论 UI 层附件交互

## 1.1 当前落地状态（2026-04-25）

以下部分已经落地到代码：

- 新增 typed LLM 配置加载器：`src/llm/config.ts`
- `provider / model / runtime / imageFallback` 相关配置已退出 env 主链路
- provider 配置改为从 `llm.providers` 按 `providerRef` 解析
- runtime 配置改为从 `llm.runtimes` 解析 `primary + imageFallback`
- CLI 已移除 `--provider`，改为 `--runtime`
- CLI 已移除 `--model`
- REPL 已移除 `/model`
- `doctor`、`repl`、`headless`、`main` 的关键路径已接入新配置

当前仍保留的过渡实现：

- 图片路由仍主要由 `Read / WebFetch` 内部判断，尚未抽成独立 `imageRouting.ts`
- `pdf / docx / xlsx` 的 skill-first 主路径已进入“builtin skills 已落地，运行策略待继续补强”状态
- unsupported 结果的 verbose 观察面仍可继续补强
- `Read / WebFetch` 已完成共享文件类型识别与 structured unsupported error 收口
- 当主模型支持 `pdfInput` 时，`Read / WebFetch` 已支持 PDF 原生直通
- PDF 附件已接入 OpenAI / Anthropic provider 映射，以及 transcript / history / trace 摘要

因此，这份文档中的“目标架构”仍然有效，但阅读时应理解为：

- 配置与 runtime 主链路已进入新架构
- 模型能力目录已落到 `modelCatalog.json`
- `runtimeProfile` 已进入 tool / agent 上下文主链路
- `prepareCliRuntime()`、`ToolContext`、`AgentRuntime` 已不再暴露 `supportsVisionInput / visionRuntime` 兼容字段
- `Read / WebFetch` 的共享分类与 unsupported 语义已落地
- `pdf` 原生处理已打通主路径，skill 主路径仍在后续开发中

## 2. 核心结论

### 2.1 多模态能力不是一个开关

不能把“多模态”建模成单个 `supportsMultimodal = true/false`。

至少要拆成能力矩阵：

- `text_input`
- `image_input`
- `file_input`
- `pdf_input`
- `tool_calling`

同时要明确区分两类能力：

1. `model-native capability`
   - 模型/接口本身直接支持的输入能力
2. `runtime/platform capability`
   - 系统通过预处理、side-query、tool 调用、文件中转等方式补齐的能力

因此，`dclaw` 不应再只维护一个“主 provider + 主 model”的单 runtime 视角，而应转向：

- 主 runtime
- 按能力补齐的 fallback runtime

短期最小实现聚焦：

- `primary runtime`
- `image fallback runtime`

但要特别强调：

- 当前只为 `image` 设计模型兜底
- 不为 `pdf_input` 或 `file_input` 设计新的模型兜底
- `pdf/file` 是否支持，只作为主模型能力判断与路由分支条件

### 2.2 文档不是单一模态，而是容器

从工程实现视角看：

- `text` 是基础输入类型
- `image` 是基础输入类型
- `pdf / docx / xlsx` 更像容器格式

它们内部可能包含：

- 文本层
- 图片页
- 表格结构
- 版面信息
- 图表/插图

所以系统不应把“附件”直接等价为“模型原生输入”，而应该增加一层：

- `acquisition`
- `normalization / extraction`
- `model routing`

### 2.3 `Read / WebFetch` 不是万能文档工具

`Read` 和 `WebFetch` 的职责应该收敛为：

- 获取内容
- 做自己明确支持类型的基础归一化
- 对不支持类型返回清晰、结构化的失败信息

它们不应承担：

- 任意 Office 文档解析
- 隐式 Bash 回退
- 隐式串联别的 tool
- 通用附件平台职责

对不支持类型，应该明确反馈给模型，让模型进一步决定：

- 调用文档处理 skill
- 或退回 Bash / Python

### 2.4 复杂文档处理优先放在 skill，而不是内建 tool

对 `docx/xlsx/pdf` 这类复杂文档，`dclaw` 当前推荐走 `skill-first` 路线，而不是增加内建 `document extractor tool`。

原因是：

- 文档处理高度依赖环境与依赖包
- 同一文档类型内部策略差异很大
- 更像一个多步 workflow，而不是稳定原子能力
- 更适合由 agent 在上下文中根据任务动态决定处理路径

在这个前提下：

- 基础工具层只保留稳定、通用的能力：
  - `Read`
  - `WebFetch`
  - `Bash`
- 文档分析流程放进 skill
- skill 内部再决定：
  - 使用哪些命令
  - 用哪种解析路径
  - 提取后如何组织分析

### 2.5 不提供内建 document extractor tool

当前设计明确约束：

- `dclaw` 不提供内建 `ExtractDocument / ExtractDocx / ExtractSpreadsheet` 这类一级 tool
- 不把文档解析固化进核心工具协议
- 文档提取能力主要通过 skill 组织
- skill 的执行仍然建立在现有基础工具之上

这样做的目标是：

- 保持工具层轻量稳定
- 不把环境依赖强塞进核心 tool contract
- 贴近 Codex / Claude Code 当前更真实的产品路线

### 2.6 模型能力信息由项目内置维护

模型是否支持：

- `image`
- `pdf`
- token limit

这类信息应收敛到项目内置的统一配置文件中，由 `dclaw` 源码维护并随版本发布。

目标是：

- 用户安装或升级 `dclaw` 后，自动获得最新模型能力信息
- 不要求用户做大量手工 provider/model 能力配置
- 用户仅在必要时通过 `~/.dclaw` 下的配置文件做局部覆盖

覆盖策略应为：

- 项目内置配置作为默认真值
- 用户配置做增量覆盖
- 最终结果为合并后的有效模型能力配置

当前实现备注：

- `llm.modelCatalogOverrides` 的 typed config 入口已经存在，并已接入解析主链路
- 内置目录已迁移到 `src/llm/modelCatalog.json`
- `modelLimits.ts` 当前主要负责目录读取、覆盖合并与环境级 token override

### 2.7 provider 相关配置全部退出 env

新架构下，以下配置不再通过环境变量提供：

- provider 选择
- model 选择
- runtime 选择
- image fallback 选择
- provider base URL
- provider API style
- provider request defaults
- provider API key

这些配置统一进入结构化配置文件：

- 用户级 `~/.dclaw/config.json`
- 项目级 `.dclaw/config.json`

环境变量只保留非 provider 配置，例如：

- `DCLAW_HOME`
- query trace
- timeout / retry / watchdog
- 其他纯运行控制开关

设计原则是：

- provider 相关信息全部 typed config 化
- 不再把结构化配置转成伪 env
- 不保留旧 env 兼容层
- 不新增另一套平铺 env 命名来替代旧方案

## 3. 与 Codex / Claude Code 的对照结论

### 3.1 Codex

Codex 核心能力是：

- 读文件
- 改文件
- 运行命令

对于 `docx/xlsx` 这类文件，核心 agent 一般仍靠模型自行判断并调用 shell / script / python。

但在 Codex app 产品层，官方又提供了处理 PDF / spreadsheet / docx 的 skills。

结论：

- 核心执行层偏 `tool / shell`
- 产品封装层偏 `skill`

### 3.2 Claude Code

Claude Code 当前内建的一等处理对象主要是：

- 文本
- 图片
- PDF
- notebook

而 `docx/xlsx` 没有看到内建 extractor tool 的正式主路径。

所以 Claude Code 面对 `docx/xlsx` 时，更接近：

- 模型自己判断需要提取
- 使用 Bash / Python / MCP / custom command 处理

结论：

- Claude Code 更偏 `tool / command-first`
- 没有把 `docx/xlsx` 做成核心一等内建能力

### 3.3 对 `dclaw` 的启发

`dclaw` 的最佳落点不是复刻某一家产品细节，而是吸收两者的共同模式：

- 核心运行时只维护稳定的工具与能力边界
- 复杂文档分析优先通过 skill 解决
- skill 底层建立在 `Read / WebFetch / Bash` 上

## 4. 设计原则

### 4.1 单一 agent 视角

对用户和大部分业务层来说，始终只有一个“当前 agent / 当前 profile”。

图片、文档到底如何被主模型消费，由 runtime 内部决定，不要把“vision agent”“document agent”暴露成第一层概念。

### 4.2 类型边界清晰

每个工具只处理它明确支持的类型。

不做“看起来有办法处理就顺手处理”，否则后续 provider、budget、权限、错误语义都会变混乱。

### 4.3 先结构化失败，再让模型规划

对不支持类型，优先返回结构化错误而不是静默失败或隐式兜底。

这样模型才能稳定学会下一步行为。

### 4.4 把“获取”和“解析”拆开

不把：

- 读本地文件
- 抓远程 URL
- Office 文档提取
- 图像理解

混成一层工具语义。

## 5. 模型能力配置与运行时能力模型

### 5.0 配置分层

推荐把配置拆成三块：

- `llm.providers`
- `llm.runtimes`
- `llm.modelCatalogOverrides`

其中：

- `providers` 负责连接信息与 provider 级 request defaults
- `runtimes` 负责 `primary + imageFallback`
- `modelCatalogOverrides` 负责局部修正模型能力与 token limit

推荐结构：

```ts
type DclawConfig = {
  llm?: {
    defaultRuntime?: string
    providers?: Record<string, ProviderProfileConfig>
    runtimes?: Record<string, RuntimeProfileConfig>
    modelCatalogOverrides?: Record<string, Partial<ModelCatalogEntry>>
  }
}

type ProviderProfileConfig = {
  type: 'openai' | 'anthropic'
  apiKey: string
  baseURL?: string
  apiStyle?: 'responses' | 'chat-completions'
  requestDefaults?: {
    verbosity?: string
    reasoningEffort?: string
    store?: boolean
  }
}

type RuntimeProfileConfig = {
  primary: {
    providerRef: string
    model?: string
  }
  imageFallback?: {
    providerRef: string
    model?: string
  }
}
```

约束建议：

- `apiKey` 只允许出现在用户级配置
- workspace config 不允许写 provider secret
- 项目级配置主要负责选 runtime、覆写 model、局部调整能力信息

### 5.1 内置模型能力配置

建议增加一份项目内置的模型能力配置文件，由仓库维护：

- `src/llm/modelCatalog.json`

建议该配置至少覆盖：

- `model pattern / model id`
- `supportsImageInput`
- `supportsPdfInput`
- `contextWindow`
- `maxOutputTokens`
- `maxOutputTokensUpperLimit`

示意结构：

```ts
type ModelCatalogEntry = {
  match: string
  supportsImageInput: boolean
  supportsPdfInput: boolean
  contextWindow: number
  maxOutputTokens: number
  maxOutputTokensUpperLimit: number
}
```

匹配规则补充：

- `match` 使用前缀匹配，而不是正则或全等匹配
- 当多个条目都能匹配时，取最长前缀
- 内置 `modelCatalog.json` 是全局目录，不再按 provider 分桶
- transport provider 只负责“怎么发请求”，不再决定“查哪本能力目录”
- `modelCatalog.json` 只维护 canonical model id，不为同一模型重复写多套别名
- 平台差异化 id 兼容应放在 `modelLimits.ts` 的 canonicalization 层，而不是继续污染 catalog
- 当前已实现的 canonicalization 例子：
  - `claude-opus-4.6` -> `claude-opus-4-6`
  - `anthropic/claude-opus-4.7` -> `claude-opus-4-7`
  - `anthropic/claude-sonnet-4.6` -> `claude-sonnet-4-6`
- 这类 canonicalization 必须是按模型前缀定向处理，不能做全局数字点号替换，否则会误伤 `gpt-5.4`、`glm-4.5` 一类模型名

### 5.2 用户覆盖配置

用户可以通过 `~/.dclaw/config.json` 对内置模型能力做局部覆盖。

覆盖范围建议限制为：

- 能力位修正
- token limit 修正
- 新模型临时补充

不建议用户覆盖：

- 工具语义
- 系统级路由原则

建议合并顺序：

1. 内置模型配置
2. 用户级配置
3. 项目级配置

最终得到当前进程可见的模型能力真值。

### 5.3 配置抽象

推荐将 runtime 配置从旧的单 `provider + model` 视角升级为：

```ts
type RuntimeProfile = {
  id: string
  primary: ModelRuntimeSpec
  imageFallback?: ModelRuntimeSpec
}

type ModelRuntimeSpec = {
  providerRef: string
  model: string
}
```

这里不再直接把 `provider` 写进 runtime，而是通过 `providerRef` 指向 `llm.providers` 中的 provider profile。

### 5.4 解析后的运行时对象

```ts
type ResolvedModelRuntime = {
  provider: 'openai' | 'anthropic' | 'stub'
  model?: string
  client: unknown
  limits?: unknown
  capabilities: {
    textInput: boolean
    imageInput: boolean
    fileInput: boolean
    pdfInput: boolean
    toolCalling: boolean
  }
}

type ResolvedRuntimeProfile = {
  id?: string
  primary: ResolvedModelRuntime
  imageFallback?: ResolvedModelRuntime
}
```

### 5.5 当前建议能力范围

短期不建议引入“任意 file input”抽象落地到所有 provider。

当前先统一这几个能力位：

- `textInput`
- `imageInput`
- `pdfInput`
- `toolCalling`

`fileInput` 可先保留为未来扩展位，但不作为当前开发主线。

这里的 `pdfInput` 定位必须收紧：

- 它只用于判断主模型是否支持原生 PDF 输入
- 不会触发新的 `pdf fallback runtime`
- 如果主模型不支持 PDF，则走工具/skill 路由

## 6. 输入类型分层

### 6.1 基础输入 artifact

```ts
type InputArtifact =
  | TextArtifact
  | ImageArtifact
  | DocumentArtifact

type TextArtifact = {
  kind: 'text'
  text: string
  source: 'read' | 'webfetch' | 'extractor'
}

type ImageArtifact = {
  kind: 'image'
  mediaType: string
  data: string
  source: 'read' | 'webfetch' | 'document_extractor'
  sourceLabel: string
}

type DocumentArtifact = {
  kind: 'document'
  format: 'pdf' | 'doc' | 'docx' | 'xls' | 'xlsx'
  source: 'read' | 'webfetch'
  path?: string
  url?: string
  mediaType: string
}
```

### 6.2 文档规范化结果

```ts
type NormalizedDocument = {
  format: 'pdf' | 'docx' | 'xlsx'
  title?: string
  textChunks: Array<{
    id: string
    text: string
    pageOrSheet?: string
  }>
  images?: ImageArtifact[]
  structuredData?: Array<{
    kind: 'table'
    name?: string
    rows: string[][]
  }>
}
```

## 7. 文件类型处理策略

### 7.1 `text`

处理方式：

- `Read` 直接读取文本
- `WebFetch` 直接提取正文文本
- 直接喂给主模型

### 7.2 `image`

处理方式：

- `Read / WebFetch` 负责获取、校验、压缩
- 如果主 runtime 支持图片输入：
  - 直接附图给主模型
- 如果主 runtime 不支持，但配置了 `imageFallback`：
  - 执行最小 side-query
  - 返回纯文本视觉分析给主模型
- 如果都不支持：
  - 返回明确错误

### 7.3 `pdf`

处理方式：

- 作为单独特判类型
- 当前策略允许：
  - 如果 runtime 支持 `pdfInput`，优先原生直通
  - 如果不支持，直接走工具/skill 路径
- `pdf` 不走新的模型 fallback
- `pdf` 的 skill 路径作为主模型不支持 `pdfInput` 时的统一收口

注意：

- “原生支持 PDF”指客户端可以直接发送 PDF 输入
- 不代表模型裸吃 PDF 二进制而不经过平台处理
- 当前不为 PDF 设计模型兜底

### 7.4 `docx`

默认处理方式：

- `Read / WebFetch` 不直接解析
- 返回“不支持直接处理”的结构化错误
- 后续由模型决定：
  - 文档处理 skill
  - Bash / Python fallback

### 7.5 `xlsx`

默认处理方式：

- `Read / WebFetch` 不直接解析
- 返回“不支持直接处理”的结构化错误
- 后续由模型决定：
  - 文档处理 skill
  - Bash / Python fallback

## 8. `Read / WebFetch` 的职责边界

### 8.1 `Read`

职责：

- 读取本地文件
- 支持明确声明的类型
- 返回基础 artifact

推荐直接支持：

- 文本文件
- 图片文件
- PDF

明确不直接支持：

- `doc`
- `docx`
- `xls`
- `xlsx`
- `ppt`
- `pptx`

### 8.2 `WebFetch`

职责：

- 获取远程内容
- 支持明确声明的远程类型
- 返回基础 artifact

推荐直接支持：

- 文本响应
- 图片响应
- PDF

明确不直接支持：

- Office 文档
- 未知二进制容器
- 泛文件下载平台

### 8.3 `Read / WebFetch` 不应做的事

- 内部隐式调用 Bash
- 内部隐式调用 skill
- 自动把控制流转交另一个 tool

它们只应：

- 自己处理支持类型
- 对不支持类型提供清晰反馈

对于 `pdf` 还要补充一个明确原则：

- `Read / WebFetch` 对 `pdf` 的首版支持边界必须一致
- 文件类型识别、media type 归类、pdf 支持判断应抽到共享文件处理层
- 不在 `Read` 和 `WebFetch` 中各自维护一套不同的 PDF 逻辑

对于图片还要补充一个明确原则：

- 如果主模型不支持图片，且也没有配置 `imageFallback`
- 那么系统应在工具/路由层明确告诉模型“当前 runtime 无法处理图片”
- 而不是继续把图片送进主模型并等待 provider 调用时报错

## 9. Claude Code 对 `WebFetch` 的启发

Claude Code 对 `WebFetch` 的选择是：

- `WebFetch` 优先自己处理远程内容
- 对二进制内容可顺手落盘，作为补充 artifact
- 但不会自动再调用 `Read`
- 后续要不要读落地文件，由模型决定

`dclaw` 应延续这一原则：

- `WebFetch` 自己处理自己支持的类型
- 必要时输出临时文件路径/落盘 artifact
- 由模型决定后续是否进一步调用 `Read` 或 extractor

## 10. tool 与 skill 的取舍

### 10.1 结论

当前路线明确选择：

- 不新增内建 document extractor tool
- 文档处理优先通过 skill 完成
- skill 底层复用 `Read / WebFetch / Bash`

### 10.2 为什么选择 skill-first

主要原因：

- 文档提取强依赖本地环境与第三方依赖
- 同类文档内部处理策略差异很大
- 更像 workflow，而不是原子工具
- 更符合 Codex 与 Claude Code 当前的实际风格

### 10.3 skill 的职责

文档处理 skill 负责：

- 判断文件类型和处理策略
- 决定使用 `Read / WebFetch / Bash` 的组合方式
- 探测环境中是否存在可用依赖
- 决定先抽正文、先做摘要、还是先做结构分析
- 将提取结果组织成后续模型容易消费的上下文

例如：

- `analyze-contract`
- `analyze-spreadsheet`
- `summarize-proposal`
- `inspect-pdf`

## 11. 失败反馈 schema

推荐为不支持类型提供统一错误结构：

```ts
type UnsupportedContentError = {
  code: 'unsupported_content_type'
  source: 'read' | 'webfetch'
  path?: string
  url?: string
  detectedMediaType?: string
  detectedExtension?: string
  suggestedNextSteps: Array<
    'use_skill' | 'use_bash_fallback'
  >
}
```

同时返回给模型的结果应同时包含：

- 结构化字段，便于稳定消费
- 简洁文字说明，便于模型直接继续规划

面向模型的错误文案应保持稳定，例如：

```text
Read does not support directly parsing .xlsx files.
Detected media type: application/vnd.openxmlformats-officedocument.spreadsheetml.sheet
Suggested next steps: use_skill, use_bash_fallback
```

## 12. 推荐数据流

### 12.1 图片

```text
Read / WebFetch
  -> ImageArtifact
  -> runtime capability check
     -> primary supports image
        -> direct image input
     -> primary does not support image + imageFallback exists
        -> side query
        -> text analysis back to primary
     -> otherwise
        -> structured error
```

### 12.2 PDF

```text
Read / WebFetch
  -> DocumentArtifact(pdf)
  -> runtime capability check
     -> primary supports pdf input
        -> direct pdf input
     -> otherwise
        -> skill / bash path
           -> PDF-specific workflow
           -> text chunks and/or page images
        -> primary consumes extracted results
```

### 12.3 DOCX / XLSX

```text
Read / WebFetch
  -> detect unsupported direct parsing
  -> structured unsupported error
  -> model decides next step
     -> skill
     -> Bash / Python fallback
```

## 13. 对 `dclaw` 的具体建议

### 13.1 运行时层

- 将当前 `runtime + supportsVisionInput + visionRuntime` 收敛成统一 profile runtime
- 保留：
  - `primary`
  - `imageFallback`
- 不新增：
  - `pdfFallback`
  - `fileFallback`

同时新增统一的模型能力配置入口：

- 项目内置模型能力配置
- 用户 `~/.dclaw` 覆盖配置
- 合并后供 runtime / tool / routing 共用

### 13.2 工具层

- 保持 `Read / WebFetch` 语义独立
- 统一它们输出的 artifact 语义
- 不统一 acquisition 层

### 13.3 文档处理层

- 不新增内建 extractor tool
- 为高频文档场景建设 skill
- 首批 skill 聚焦：
  - `pdf`
  - `docx`
  - `xlsx`
- skill 按类型拆分，不做单一通用 document skill

### 13.4 规划层

- 模型在收到不支持类型反馈后，自主决定：
  - 走 skill
  - 走 Bash

## 14. 分阶段实施计划

### 阶段 1：能力建模与边界收口

注：本阶段以“设计冻结与口径收敛”为完成标准，以下事项已完成设计确认。

- [x] 设计项目内置模型能力配置文件
- [x] 设计用户覆盖配置与合并规则
- [x] 定义 runtime capability 类型
- [x] 定义 `primary + imageFallback`
- [x] 明确 `Read / WebFetch` 支持矩阵
- [x] 统一 unsupported error schema

### 阶段 2：`Read / WebFetch` 收口

- [x] `Read` 已明确支持文本/图片，并对复杂文档返回结构化 unsupported error
- [x] `WebFetch` 已明确支持文本/图片，并对复杂文档返回结构化 unsupported error
- [x] 对 `docx/xlsx` 返回结构化 unsupported error
- [x] 保持图片路径统一走 artifact + routing
- [x] 当主模型支持 `pdfInput` 时，`Read / WebFetch` 已支持 `pdf` 原生直通
- [x] 当主模型不支持 `pdfInput` 时，`pdf` 继续统一收口到 unsupported + skill-first
- [x] 当主模型不支持图片且没有 `imageFallback` 时，返回稳定、可被模型理解的“无法处理图片”错误，而不是让 provider 调用失败

### 阶段 3：文档 skill 主路径

- [x] 设计文档处理 skill 的元数据约定
- [x] 设计 skill 内使用 `Read / WebFetch / Bash` 的推荐工作流
- [x] 为 `docx` 增加首个文档分析 skill（`doc`）
- [x] 为 `xlsx` 增加首个文档分析 skill（`spreadsheet`）
- [x] 为 `pdf` 增加首个文档分析 skill（`pdf`）
- [x] 按 Codex 风格补强 `pdf` skill：
  - 增加更完整的 visual review / text extraction / generation / final QA 分支
  - 增加更明确的依赖探测、安装建议和失败回退
  - 已补充配套 `scripts/` 与 `references/`
- [x] 按 Codex 风格补强 `spreadsheet` skill：
  - 增加 workbook 结构检查、sheet 摘要、header/sample/formula 分支
  - 明确 CSV / XLS / XLSX 的差异化工作流
  - 已补充配套 `scripts/` 与 `references/`
- [x] 按 Codex 风格补强 `doc` skill：
  - 增加结构提取、布局检查、DOCX -> PDF 渲染验证分支
  - 明确 `.doc`、`.docx`、OOXML fallback 的路径
  - 已补充配套 `scripts/` 与 `references/`
- [x] 为三类文档 skill 建立更明确的质量门槛：
  - 输出中区分“内容提取结论”和“布局/视觉结论”
  - 要求在必要时重新 render / reopen / resample 验证
  - 明确中间产物目录、清理策略和最终交付检查项
- [x] 让 unsupported 提示与 skill 更紧密对齐：
  - `pdf` 指向 `pdf`
  - `doc/docx` 指向 `doc`
  - `xls/xlsx/csv/...` 指向 `spreadsheet`
  - unsupported 结果文案已明确提示调用 `Skill` tool，并给出精确 `skill_name`
  - `Skill` tool prompt 已补充文档 unsupported -> builtin skill 的稳定衔接规则

### 阶段 4：skill 运行与回退策略

- [ ] 明确文档 skill 的环境探测策略
- [ ] 明确文档 skill 的 Bash fallback 策略
- [ ] 明确 skill 失败时的可观察性与错误语义
- [ ] 明确 skill 与纯 Bash 方案的优先级

### 阶段 5：运行时切换与 profile

- [ ] 支持 runtime profile
- [ ] 支持 REPL / session 级切换
- [ ] 让图片 fallback 与 profile 同步切换

## 15. 已确认实现口径

- `pdf` 继续作为内建特判；当主模型不支持 `pdfInput` 时，再统一收口到 skill-first 路径
- 文档 skill 按类型拆分多个 skill，首批为 `pdf / docx / xlsx`
- `Read / WebFetch` 对 `pdf` 的首版支持边界保持一致，并抽出共享文件处理层
- unsupported error 采用“结构化字段 + 稳定文字说明”的双轨返回，让模型可直接继续规划
- 内置模型能力配置文件采用 `JSON` 形式，即 `src/llm/modelCatalog.json`
- 用户覆盖配置不单独建文件，直接并入现有 `~/.dclaw/config.json`
- 项目级覆盖继续使用 `.dclaw/config.json`
- skill 元数据应预留依赖探测与推荐工作流约定

## 16. 最终建议

当前最稳的方案是：

1. 把多模态运行时建模成“主 runtime + 能力补齐 runtime”
2. 把 `text / image / document` 分成不同处理层
3. 让 `Read / WebFetch` 只处理自己支持的类型
4. 用项目内置配置统一维护模型图片/PDF能力与 token limit，并允许用户在 `~/.dclaw` 局部覆盖
5. 只为图片设计模型兜底，不为 PDF/file 设计新的模型兜底
6. provider 相关配置统一进入 typed config，不再使用 env
7. `pdf` 作为内建特判保留，主模型不支持时再收口到 skill-first
8. 对复杂文档优先建设按类型拆分的 skill，而不是内建 extractor tool
9. skill 底层建立在 `Read / WebFetch / Bash` 上
8. 对不支持类型明确反馈给模型，由模型自主继续决策

这套方案兼容：

- 现在的 `dclaw` 代码结构
- Claude Code 对 `Read / WebFetch / PDF` 的边界处理方式
- Codex 对 skill 与 shell 并存的产品路线

同时也为后续继续扩到：

- 更完整的 PDF 路径
- profile 切换
- 更复杂文档类型

保留了足够清晰的演进空间。
