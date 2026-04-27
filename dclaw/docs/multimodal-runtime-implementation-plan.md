# 多模态运行时实施计划

相关文档：

- [多模态运行时与文档处理设计](./multimodal-runtime-design.md)
- [多模态输入任务清单](./multimodal-input-todo.md)

## 1. 目标

把多模态运行时方案拆成可以直接开发和验收的实施清单，覆盖：

- 模型能力目录与用户覆盖
- `primary + imageFallback` 运行时
- `Read / WebFetch` 的支持边界收口
- 图片兜底与稳定错误语义
- `pdf / docx / xlsx` 的 skill-first 路线
- doctor / REPL / 测试 / 文档配套

这份文档只关注“怎么落地”，不重复解释为什么这样设计。设计原则以 [多模态运行时与文档处理设计](./multimodal-runtime-design.md) 为准。

## 1.1 当前进度（2026-04-25）

当前代码状态可以概括为：

- 阶段 2 已进入“主体落地，兼容字段已清理”状态
- 阶段 1 已进入“目录落地、命名与调用面待继续收口”状态
- 阶段 3 已进入“共享分类、unsupported 语义、pdf 直通、builtin skills 与 unsupported -> skill 对齐已落地，运行策略与观察面待继续”状态

已完成的主链路：

- [x] 新增 `src/llm/config.ts`
- [x] 新增 `src/llm/modelCatalog.json`
- [x] 直接解析 `llm.providers / llm.runtimes / llm.defaultRuntime`
- [x] workspace config 中禁止 `provider.apiKey`
- [x] `providerConfig.ts` 改为按 `providerRef` 解析 provider profile
- [x] `modelLimits.ts` 改为从 `modelCatalog.json` 解析内置能力目录
- [x] `modelCatalogOverrides` 已接入 `runtime / QueryEngine / doctor / provider clients`
- [x] `runtimeConfig.ts` 改为解析 `primary + imageFallback`
- [x] `cli` 改为 `--runtime`，移除 `--provider`
- [x] `doctor / repl / headless / main` 已接入新 runtime 解析
- [x] provider/model/runtime 相关配置已退出 env 主链路
- [x] `ToolContext` / `AgentRuntime` 已接入 `runtimeProfile`
- [x] `Read / WebFetch` 已优先读取 `runtimeProfile` 中的图片能力与 fallback runtime
- [x] `prepareCliRuntime()` 不再导出 `supportsVisionInput / visionRuntime` 兼容字段
- [x] `ToolContext` / `AgentRuntime` 已移除 `supportsVisionInput / visionRuntime` 兼容字段
- [x] `Read / WebFetch` 在主模型支持 `pdfInput` 时已支持 PDF 原生直通
- [x] PDF 内容块已接入 OpenAI / Anthropic provider 映射
- [x] transcript / history / query trace 已能摘要显示 PDF 附件

仍未完成的关键收口：

- [ ] `pdf / docx / xlsx` 的 skill-first 运行策略收口
- [ ] unsupported 结果的 verbose / transcript 可观察性

## 2. 已冻结决策

开发前先固定以下结论，避免边做边改：

1. 只为 `image` 提供模型兜底。
2. 不为 `pdf_input` 或 `file_input` 提供新的 fallback runtime。
3. `pdf` 是否可直通，只取决于主模型能力；不支持时直接走 tool/skill。
4. `docx/xlsx` 不做内建 extractor tool，走 `skill-first`。
5. `Read / WebFetch` 只处理自己明确支持的类型。
6. 模型能力信息由仓库内置维护，用户只在 `~/.dclaw` 做局部覆盖。
7. provider 相关配置全部退出 env，不做兼容保留。
8. `pdf` 保留内建特判，主模型不支持 `pdfInput` 时再收口到 skill-first。
9. 文档 skill 按类型拆分多个 skill，不做单一通用 document skill。
10. 首版不做 profile 持久化切换，不做会话级 runtime switch event。

## 3. 推荐里程碑

建议拆成 6 个阶段，按顺序推进：

1. 阶段 1：模型能力目录收口
2. 阶段 2：运行时对象升级为 `primary + imageFallback`
3. 阶段 3：`Read / WebFetch` 支持边界与错误语义收口
4. 阶段 4：图片路由与 image fallback 收口
5. 阶段 5：文档 skill 主路径
6. 阶段 6：观察面、文档与回归测试收口

阶段 1-4 是主线，建议连续完成后再开始阶段 5。

## 4. 阶段 1：模型能力目录收口

### 4.1 目标

把当前散落在 `modelLimits.ts` 里的能力与 token 信息，收敛成统一的模型能力目录，并支持：

- 仓库内置默认值
- `~/.dclaw/config.json` 局部覆盖
- 项目级 `.dclaw/config.json` 局部覆盖

### 4.2 代码改动

新增文件：

- `src/llm/modelCatalog.json`

建议新增类型：

```ts
export type ModelCatalogEntry = {
  match: string
  contextWindow: number
  maxOutputTokens: number
  maxOutputTokensUpperLimit: number
  supportsImageInput: boolean
  supportsPdfInput: boolean
}
```

修改文件：

- `src/llm/modelLimits.ts`
- `src/cli/configFile.ts`
- `src/cli/doctor.ts`
- `src/cli/replCommands.ts`

### 4.3 具体任务

- [x] 从 `modelLimits.ts` 中抽出内置 limits/capabilities 规则到 `modelCatalog.json`
- [x] 把 `supportsVisionInput` 统一重命名为 `supportsImageInput`
- [x] 新增 `supportsPdfInput`
- [x] 在 `modelLimits.ts` 中新增统一解析出口：
  - `resolveModelCatalogEntry(...)`
  - `resolveModelLimits(...)`
  - `resolveModelCapabilities(...)`
- [x] 定义 typed config 结构，允许从 `~/.dclaw/config.json` 和 `.dclaw/config.json` 读取：
  - `llm.modelCatalogOverrides.<match>`
- [x] 明确合并顺序：
  - built-in catalog
  - user config
  - workspace config
- [x] 把跨平台模型别名兼容收口到 `modelLimits.ts` 的 canonicalization 层
  - `modelCatalog.json` 只维护 canonical model id
  - 例如兼容 `claude-opus-4.6` 与 `anthropic/claude-opus-4.7`
- [x] 把内置模型能力目录改成全局 `entries`
  - 已不再按 provider 分桶
  - provider 仅作为未知模型的 fallback defaults 来源
- [x] `doctor` 输出解析后的：
  - `supportsImageInput`
  - `supportsPdfInput`
  - `contextWindow`
  - `maxOutputTokens`

### 4.4 测试

修改或新增：

- `test/unit/model-limits.test.ts`
- `test/unit/config-file.test.ts`
- `test/unit/doctor.test.ts`

覆盖点：

- [x] 内置目录命中
- [x] 用户配置按全局 `match` + prefix 覆盖
- [x] workspace 配置可继续覆盖用户配置
- [x] `supportsImageInput` 和 `supportsPdfInput` 可独立覆盖
- [x] doctor 正确显示最终值

### 4.5 验收标准

- `modelLimits.ts` 不再自己维护第二套能力表
- CLI 可通过单一路径得到最终模型能力信息
- 用户不配置任何东西时，也能拿到项目内置的能力真值

## 5. 阶段 2：运行时对象升级为 `primary + imageFallback`

### 5.1 目标

把当前：

- `runtime`
- `supportsVisionInput`
- `visionRuntime`

升级成统一运行时对象，避免继续在 CLI 和 tool 层手拼视觉能力。

### 5.2 代码改动

新增文件：

- `src/llm/runtimeProfile.ts`
- `src/llm/config.ts`

修改文件：

- `src/llm/runtimeConfig.ts`
- `src/cli/runtime.ts`
- `src/types/tool.ts`
- `src/core/queryEngine.ts`
- `src/cli/doctor.ts`
- `src/cli/replCommands.ts`
- `src/llm/providerSelection.ts`
- `src/llm/providerConfig.ts`

### 5.3 建议类型

```ts
export type RuntimeProfileSpec = {
  primary: {
    providerRef: string
    model?: string
  }
  imageFallback?: {
    providerRef: string
    model?: string
  }
}

export type ResolvedModelRuntime = {
  providerRef: string
  provider: LlmProviderName
  model?: string
  providerConfig: ResolvedProviderConfig
  modelLimits?: ModelLimits
  capabilities: {
    supportsImageInput: boolean
    supportsPdfInput: boolean
  }
  client: LlmClient
}

export type ResolvedRuntimeProfile = {
  primary: ResolvedModelRuntime
  imageFallback?: ResolvedModelRuntime
}
```

### 5.4 具体任务

- [x] 在 `config.ts` 中新增 typed config loader，直接解析：
  - `llm.providers`
  - `llm.runtimes`
  - `llm.defaultRuntime`
- [x] 重写 `providerConfig.ts`，改为按 `providerRef` 解析 provider profile
- [x] 删除 `providerSelection.ts` 的旧 env/provider 选择逻辑
- [x] 在 `runtimeConfig.ts` 中把出口改成可复用的 model runtime resolver
- [ ] 新增 `resolveRuntimeProfile(...)`
- [x] CLI 不再接受 `--provider`
- [x] 新增 `--runtime <name>` 作为运行时选择入口
- [x] CLI 不再接受 `--model`
- [x] REPL 不再提供 `/model`，未知 slash command 会在本地稳定报错，不会透传给模型
- [x] 将 `prepareCliRuntime()` 的返回值从：
  - `runtime + supportsVisionInput + visionRuntime`
  - 改为 `runtimeProfile`
- [x] `prepareCliRuntime()` 不再导出兼容字段
- [x] `ToolContext` 去掉：
  - `supportsVisionInput`
  - `visionRuntime`
- [x] `ToolContext` 新增：
  - `runtimeProfile`
- [x] `AgentRuntime` / subagent context 接入 `runtimeProfile`
- [x] `QueryEngine` 统一接入 `runtimeProfile.primary`
- [x] `doctor` 输出：
  - `primary`
  - `imageFallback`
  - 当前能力位
- [x] 对 workspace config 中出现 `provider.apiKey` 的情况直接报错

### 5.5 测试

修改或新增：

- `test/unit/runtime-config.test.ts`
- `test/unit/doctor.test.ts`
- `test/unit/repl-commands.test.ts`

覆盖点：

- [x] `primary` 解析正常
- [x] `imageFallback` 解析正常
- [x] 未配置 fallback 时值为空
- [x] `--runtime` 能正确切换 runtime
- [x] workspace provider secret 会被拒绝
- [x] doctor/repl 输出符合新结构

### 5.6 验收标准

- `prepareCliRuntime()` 不再单独暴露 `supportsVisionInput` 和 `visionRuntime`
- 图片能力判断统一来自 `runtimeProfile.primary.capabilities`
- image fallback 不再是 CLI 特判拼装物
- provider/model/runtime 不再从 env 解析

## 6. 阶段 3：`Read / WebFetch` 支持边界与错误语义收口

### 6.1 目标

明确：

- `Read` 支持哪些本地类型
- `WebFetch` 支持哪些远程类型
- 不支持时返回什么结构

同时保证两者不再隐式承担复杂文档处理职责。

### 6.2 代码改动

新增文件：

- `src/tools/contentTypes.ts`
- `src/tools/fileHandling.ts`

可选新增文件：

- `src/tools/errors.ts`

修改文件：

- `src/tools/builtin/readFile.ts`
- `src/tools/builtin/webFetch.ts`
- `src/types/tool.ts`
- `src/tools/builtin/readFilePrompt.ts`
- `src/tools/builtin/webFetchPrompt.ts`
- `src/cli/outputFormatting.ts`

### 6.3 建议类型

```ts
export type UnsupportedContentError = {
  code: 'unsupported_content_type' | 'unsupported_runtime_capability'
  source: 'read' | 'webfetch'
  path?: string
  url?: string
  detectedMediaType?: string
  detectedExtension?: string
  contentKind: 'image' | 'pdf' | 'office_document' | 'unknown_binary'
  suggestedNextSteps: Array<
    'use_skill' | 'use_bash_fallback' | 'ask_for_text_alternative' | 'configure_image_support'
  >
}
```

### 6.4 具体任务

- [x] 抽出统一的 media type / extension 识别辅助函数
- [x] 抽出共享文件处理层，统一：
  - 文件类型识别
  - media type 归类
  - `pdf` / office / binary 分类
- [x] 明确 `Read` 首版直接支持：
  - 文本
  - 图片
  - `pdf`
- [x] 明确 `WebFetch` 首版直接支持：
  - 文本
  - 图片
  - `pdf`
- [x] 对 `docx/xlsx/pptx/...` 返回稳定 unsupported error
- [x] 不再在 `Read / WebFetch` 内部自动决定：
  - 调 skill
  - 调 bash
- [x] `Read / WebFetch` 对 `pdf` 采用一致的首版支持边界
- [x] 更新工具 prompt，明确告诉模型：
  - 遇到不支持文档类型时应改用 skill 或 Bash
- [ ] 为 verbose/transcript 补最小可观察性，至少能看到：
  - unsupported type
  - source path/url
  - next step suggestion

### 6.5 测试

修改或新增：

- `test/unit/read.test.ts`
- `test/unit/read-limits.test.ts`
- `test/unit/webfetch-ask.test.ts`
- `test/unit/output-formatting.test.ts`

覆盖点：

- [x] 读取 `docx` 返回稳定 unsupported error
- [x] 抓取 `xlsx` 返回稳定 unsupported error
- [x] `Read / WebFetch` 对 `pdf` 的支持边界一致
- [x] 图片与文本路径不受影响
- [ ] verbose 可显示 unsupported 提示

### 6.6 验收标准

- `Read / WebFetch` 的能力边界在 prompt、输出和错误语义上都一致
- 复杂文档不再在工具内部偷偷走隐式分支

## 7. 阶段 4：图片路由与 image fallback 收口

### 7.1 目标

把图片直传与视觉 side query 的判断，统一到新的运行时能力模型上，并保证：

- 主模型支持图片时直接处理
- 主模型不支持且有 `imageFallback` 时走 side query
- 两者都不支持时给模型稳定反馈，而不是 provider 报错

### 7.2 代码改动

新增文件：

- `src/llm/imageRouting.ts`

修改文件：

- `src/tools/builtin/readFile.ts`
- `src/tools/builtin/webFetch.ts`
- `src/llm/visionSideQuery.ts`
- `src/types/tool.ts`
- `src/cli/runtime.ts`

### 7.3 具体任务

- [ ] 抽出统一的图片路由函数，例如：
  - `resolveImageHandlingMode(context.runtimeProfile)`
- [ ] 统一三种结果：
  - `inline-primary`
  - `side-query-fallback`
  - `unsupported`
- [ ] `readFile.ts` 和 `webFetch.ts` 都改成复用这一套路由逻辑
- [x] 明确 unsupported 时返回统一错误文案：
  - 当前主 runtime 不支持图片
  - 也未配置 image fallback
- [ ] 保持 `runVisionSideQuery(...)` 仅用于图片
- [ ] 禁止把 `pdf` 路由进 vision side query

### 7.4 测试

修改或新增：

- `test/unit/read.test.ts`
- `test/unit/webfetch-ask.test.ts`
- `test/unit/runtime-config.test.ts`

覆盖点：

- [ ] 主模型支持图片时直接返回图片内容
- [ ] 主模型不支持但 fallback 支持时走 side query
- [x] 两者都不支持时返回稳定错误
- [ ] `pdf` 不会意外走 image fallback

### 7.5 验收标准

- 图片处理策略在 `Read` 和 `WebFetch` 中表现一致
- “无法处理图片”变成显式产品语义，而不是 provider 失败副作用

## 8. 阶段 5：文档 skill 主路径

### 8.1 目标

不给核心工具层增加 extractor tool，而是把复杂文档处理工作流收口到 builtin skills。

### 8.2 代码改动

新增目录：

- `src/skills/builtin/`

建议新增 skill 文件：

- `src/skills/builtin/pdf/SKILL.md`
- `src/skills/builtin/doc/SKILL.md`
- `src/skills/builtin/spreadsheet/SKILL.md`

修改文件：

- `src/skills/loader.ts`
- `src/tools/builtin/skillPrompt.ts`
- `src/tools/builtin/readFilePrompt.ts`
- `src/tools/builtin/webFetchPrompt.ts`
- `docs/skill-spec.md`

### 8.3 具体任务

- [x] 创建 builtin skill 目录并接入 loader
- [x] 约定文档 skill 的 frontmatter 最小字段：
  - `name`
  - `description`
  - `context`
- [x] 首批提供 3 个按类型拆分的 builtin skills：
  - `pdf`
  - `doc`
  - `spreadsheet`
- [ ] skill prompt 中明确建议优先使用：
  - `Read`
  - `WebFetch`
  - `Bash`
- [x] `pdf` skill 明确只在主模型不支持 `pdfInput` 或需要补充提取流程时使用
- [x] skill 内容里给出依赖探测顺序，例如：
  - `python` + 三方库
  - 系统命令
  - unzip/xml fallback
- [x] `Skill` tool prompt 补一段文档场景指引，帮助模型在 unsupported error 后自然切换到 skill
- [x] 如果某类文档 skill 最终还是要走 Bash，skill 应负责告诉模型：
  - 先检查依赖
  - 失败后如何降级
  - 输出该保留哪些结构信息

### 8.4 测试

修改或新增：

- `test/unit/skill-loader.test.ts`
- `test/unit/skill-tool.test.ts`

覆盖点：

- [x] builtin document skills 能被 loader 发现
- [x] `Skill` tool 可以调用这些 skills
- [x] skill 元数据正确展示
- [x] 文档 skill 仍保持按类型拆分，不会被注册成单一 document skill

### 8.5 验收标准

- 模型在收到 `docx/xlsx` unsupported error 后，已经有清晰的 builtin skill 可以选用
- 核心代码里仍然没有 `ExtractDocument` 这类一级工具

## 9. 阶段 6：观察面、文档与回归测试收口

### 9.1 目标

让新方案在 doctor、REPL、日志、文档和测试中都可观察、可维护。

### 9.2 代码改动

修改文件：

- `src/cli/doctor.ts`
- `src/cli/replCommands.ts`
- `src/cli/outputFormatting.ts`
- `src/cli/parseArgs.ts`
- `docs/multimodal-runtime-design.md`
- `docs/multimodal-input-todo.md`
- `docs/dev-tasks.md`
- `docs/project-status.md`

### 9.3 具体任务

- [ ] `doctor` 展示：
  - 当前 primary
  - image fallback
  - supports image/pdf
  - resolved token limits
- [ ] `/config` 或 `doctor` 输出用户覆盖是否生效
- [ ] `/config` 或 `doctor` 输出当前 runtime 来自：
  - user config
  - workspace config
  - CLI override
- [ ] verbose 中让以下事件可见：
  - 图片直传
  - 图片 side query
  - unsupported document type
- [ ] CLI help 删除 `--provider`，加入 `--runtime`
- [ ] 把多模态任务状态同步进 `dev-tasks.md` 与 `project-status.md`
- [ ] 对照本实施计划更新设计文档状态

### 9.4 测试

建议完整跑一轮：

- `npm test -- model-limits`
- `npm test -- runtime-config`
- `npm test -- read`
- `npm test -- webfetch-ask`
- `npm test -- skill-loader`
- `npm test -- skill-tool`
- `npm test -- doctor`
- `npm test -- repl-commands`

### 9.5 验收标准

- 新能力在 CLI 里可被诊断
- 文档、实现、测试三者口径一致

## 10. 开发顺序建议

推荐严格按下面顺序提交，避免交叉返工：

1. 先完成阶段 1，只改模型目录与配置解析，不碰 tool 行为
2. 再完成阶段 2，把运行时对象收口
3. 再完成阶段 3，统一 unsupported error
4. 再完成阶段 4，统一 image fallback
5. 然后做阶段 5，补 builtin document skills
6. 最后做阶段 6，统一观察面和文档

不建议一开始就同时改 runtime、Read/WebFetch、skills。这样很容易把边界再次搅混。

## 11. 并行开发建议

如果多人并行，推荐这样拆：

- Worker A：阶段 1 能力目录与配置合并
- Worker B：阶段 2 runtime profile
- Worker C：阶段 3-4 `Read / WebFetch` 收口
- Worker D：阶段 5 builtin document skills

并行前提：

- Worker B 等待阶段 1 类型冻结
- Worker C 等待阶段 2 的 `ToolContext.runtimeProfile`
- Worker D 可先独立准备 skill 文案与目录结构

## 12. 首批不做

以下内容明确不进这轮实施：

- 会话内动态切换 runtime profile
- `pdfFallback` / `fileFallback`
- 内建 `ExtractDocument` tool
- 音频、视频、OCR 通用抽象
- 通用附件上传平台
- `docx/xlsx` 原生 provider 输入
- 自动从 unsupported error 直接隐式调用 skill

## 13. 开发完成定义

这轮工作完成，需要同时满足：

1. 模型能力信息有统一内置目录，且可被用户配置局部覆盖。
2. CLI 运行时已经切到 `primary + imageFallback`。
3. `Read / WebFetch` 对复杂文档返回稳定 unsupported error。
4. 图片在“不支持 + 无 fallback”时返回稳定错误，而不是 provider 报错。
5. 至少有 3 个 builtin document skills 可用。
6. provider/model/runtime 相关 env 已完全退出解析链路。
7. `Read / WebFetch` 对 `pdf` 的首版支持边界已经统一并收口到共享文件处理层。
8. doctor、REPL、测试、文档都已同步更新。
