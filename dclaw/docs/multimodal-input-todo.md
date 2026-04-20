# 多模态输入任务清单

## 1. 目标

为 `dclaw` 增加与 Claude Code 当前源码主路径尽量一致的多模态输入能力。

当前这项工作的严格边界：

- 只做消息级 `content blocks` 主路径
- 当前优先做“模型通过工具读取图片并继续分析”
- 不额外发明通用附件系统
- 不顺手扩成 PDF、音频、视频、OCR、文件上传平台

这里再补一条很重要的实现分层：

- 第一阶段优先支持“模型调用工具读取图片，并把图片作为结构化结果回给模型”
- 第一阶段内优先打通 `tool_result` 结构化图片回传与 `WebFetch` 远程图片读取
- 第二阶段再补“用户附图给模型看”
- `--print --image` 暂不进入近期主线

记住我们的原则：无限靠拢 Claude Code 的实现，不额外加戏。

## 2. 设计结论

根据 Claude Code 当前源码，真正的一等公民不是“附件”，而是：

- 用户消息 `content` 可以同时包含 `text` 与 `image`
- 图片在进入模型前会被整理成消息块
- 输入侧、会话侧、provider 侧都围绕同一份消息模型工作

对 `dclaw` 来说，最小且正确的落地顺序应是：

1. 先改共享消息模型
2. 再改 provider 适配
3. 再改 `tool_result` 的结构化多模态回填
4. 再打通图片读取工具链路，优先 `WebFetch`
5. 最后再补用户输入入口

同时要明确三条不同链路：

1. 模型主动取本地图片：
   - 模型先调用工具
   - 工具读取本地图片
   - 通过结构化 `tool_result` 把图片回传给模型
2. 模型主动取远程图片：
   - 模型先调用工具
   - 工具从 URL 获取远程图片
   - 通过结构化 `tool_result` 把图片回传给模型
3. 用户附图：
   - 输入层读取图片
   - 写入 user message `image block`
   - 直接进入本轮模型上下文

## 3. 明确不做

以下内容本轮明确不做：

- 通用 attachment 平台
- PDF 输入
- 音频输入
- 视频输入
- OCR / caption / 图像预摘要
- provider 文件上传中转
- 终端内图片预览 UI
- 在当前 `readline` REPL 上伪装 Claude Code 级粘贴体验

另外，下面这条不是“不做”，而是**不进入第一阶段**：

- `--print --image`
- 用户附图输入主路径

## 4. 任务拆解

### 4.1 P0：消息模型收口到 image content block

- [ ] 在 `src/types/message.ts` 增加图片消息块类型
- [ ] 新增最小图片 source 结构：
  - `type: 'base64'`
  - `mediaType`
  - `data`
- [ ] 将 `ContentBlock` 联合类型扩展为：
  - `text`
  - `image`
  - `thinking`
  - `redacted_thinking`
  - `reasoning`
  - `tool_use`
  - `tool_result`
- [ ] 保持 `Message.content` 作为唯一真值
- [ ] 不引入独立 `Attachment` / `Asset` / `Upload` 实体
- [ ] 补充最小辅助函数，确保“提取文本”和“识别非文本消息”仍可工作

涉及文件：

- `src/types/message.ts`
- `src/session/transcript.ts`
- 视需要补到引用 `ContentBlock` 的公共工具模块

验收标准：

- 用户消息可以同时包含 `text` 和 `image`
- 现有 `tool_use / tool_result` 链路不受影响
- history/transcript 遇到图片时不再退化成完全不可辨识的 `[non-text content]`

### 4.2 P0：Anthropic provider 打通图片透传

- [ ] 为 `Anthropic` provider 增加 image content block 映射
- [ ] 请求映射时保留用户消息里的 `text + image` 顺序
- [ ] 非用户消息不引入额外图片逻辑
- [ ] 响应解析逻辑保持现状，不额外伪造图片输出能力
- [ ] 在 API 边界增加最小图片大小校验

涉及文件：

- `src/llm/providers/anthropic.ts`
- `src/llm/types.ts`
- 新增一个最小图片校验模块或 provider 侧校验函数

验收标准：

- `Anthropic` 请求体可以携带 base64 image block
- 文本-only 请求与现有行为一致
- 图片超限时返回明确错误，而不是 provider 侧随机 400

### 4.3 P0：OpenAI Responses 主路径支持图片输入

- [ ] 为 `OpenAI Responses` 输入模型补充多模态 user item 映射
- [ ] 不再把包含图片的用户消息打平成纯字符串
- [ ] 保留 block 顺序，不提前做本地图像理解
- [ ] 在有图片时仍允许工具调用主循环继续工作
- [ ] 与 `Anthropic` 共用图片大小校验逻辑

涉及文件：

- `src/llm/providers/openai.ts`

验收标准：

- `OpenAI Responses API` 请求可以携带 `text + image`
- 工具调用、streaming、reasoning 现有主路径不被破坏

### 4.4 P0：显式收紧 OpenAI chat-completions 边界

- [ ] 审查当前 `chat-completions` 分支是否天然支持图片输入
- [ ] 若当前实现无法无偏差对齐，则在检测到图片输入时显式报错
- [ ] 或在能力边界明确可控时，将含图片请求自动收敛到 `responses`
- [ ] 不为了“看起来支持”而自行拼接非标准 shim

涉及文件：

- `src/llm/providers/openai.ts`
- `src/llm/providerSelection.ts`
- `src/llm/providerConfig.ts`

验收标准：

- 含图片的 OpenAI 请求不会静默丢图
- 用户能得到明确、稳定、可预期的行为

### 4.5 P0：工具结果支持结构化多模态 content

这一阶段开始支持“模型主动取图”链路，但仍然只围绕图片，不扩成泛化附件平台。

- [ ] 将 `tool_result` 通道从“仅文本/JSON”扩展为可承载结构化 content blocks
- [ ] 明确 `tool_result` 至少可承载：
  - `text`
  - `image`
- [ ] 保持现有纯文本/JSON tool result 完全兼容
- [ ] 不为了支持图片结果而重写整个 tool 协议
- [ ] 在 query loop 中确认工具结果回填给模型时不会丢失结构化 block
- [ ] 在 transcript / verbose / trace 中为“tool 返回图片”提供受控摘要
- [ ] 不在 transcript / log 中输出原始 base64

涉及文件：

- `src/types/message.ts`
- `src/core/queryLoop.ts`
- `src/types/tool.ts`
- `src/tools/types.ts`
- `src/session/transcript.ts`
- `src/cli/verboseEvents.ts`

验收标准：

- tool result 可以携带图片 block 回到模型
- 现有所有文本型工具不需要跟着大改
- query loop 不会把结构化 tool result 压扁成字符串

### 4.6 P0：远程图片读取工具链路，优先 WebFetch

这一阶段支持模型通过 URL 获取远程图片，并把图片作为结构化结果交回模型。

边界要收紧：

- 这是图片读取能力，不是通用下载器
- 优先复用 `WebFetch` 主路径，不先发明第二套网络工具
- 只处理明确是图片的远程资源
- 不顺手扩成“任意二进制文件下载”

- [ ] 评估并优先复用 `WebFetch` 的请求/权限/重定向主链路
- [ ] 支持从 URL 下载远程图片
- [ ] 校验协议、重定向、content-type、大小限制
- [ ] 明确下载超时与失败语义
- [ ] 将远程图片转成 `image block` 回传给模型
- [ ] 保持与本地图片读取工具链路尽量一致
- [ ] 不在第一版引入缓存、对象存储、临时上传中心等额外机制

涉及文件：

- `src/tools/WebFetch*` 或其直接相关模块
- `src/core/queryLoop.ts`
- 视需要新增轻量图片下载/识别模块

验收标准：

- 模型可通过 `WebFetch` 路径抓取远程图片并继续分析
- 非图片 URL 不会被静默当成图片
- 超大/异常远程响应不会把主链路拖垮

### 4.7 P1：本地图片读取工具链路

这一阶段支持模型主动读取本地图片文件，再把图片交回模型分析。

- [ ] 评估当前 `Read` 是否应扩展为支持图片文件
- [ ] 若与现有 `Read` 语义冲突，则新增最小专用图片读取工具
- [ ] 工具输入至少支持：
  - 本地图片路径
- [ ] 工具输出至少支持：
  - 可选文本摘要
  - 原始图片 `image block`
- [ ] 加入路径校验、大小限制、media type 识别
- [ ] 对非图片路径、损坏图片、超限图片给出明确错误
- [ ] 保持权限语义与现有文件读取工具一致

涉及文件：

- `src/tools/registry.ts`
- `src/tools/*`
- `src/types/tool.ts`
- `src/core/queryLoop.ts`

验收标准：

- 模型可以通过工具读取本地图片
- 工具结果中的图片能继续进入后续模型推理
- 不需要用户手工先把图片转 base64 再贴给 agent

### 4.8 P1：会话持久化与 transcript 观察面补齐

- [ ] 确认 `messages.jsonl` 可以稳定持久化 image block
- [ ] `resume` 后图片消息结构不丢失
- [ ] transcript / history 对图片给出受控文本表示，例如：
  - `[image]`
  - `[2 images]`
  - `[text + 1 image]`
- [ ] 不在 transcript 中输出整段 base64
- [ ] verbose / SSE 如需展示内容摘要，只输出图片占位，不输出原始数据

涉及文件：

- `src/session/store.ts`
- `src/session/transcript.ts`
- `src/cli/interactiveSession.ts`
- `src/cli/verboseEvents.ts`

验收标准：

- session resume 后仍能继续携带历史图片上下文
- transcript 可读且不会泄露/刷屏 base64 数据

### 4.9 P2：QueryEngine 输入面支持结构化用户消息

这一阶段开始补用户附图主路径，但不再把它作为近期第一优先级。

- [ ] 将 `QueryEngine.submitUserPrompt()` 从只接收 `string` 扩展为支持结构化输入
- [ ] `submitUserPromptWithHandlers()` 同步支持结构化输入
- [ ] 引入最小输入类型，例如：
  - `string`
  - `ContentBlock[]`
- [ ] 用户消息入库时保留原始 block 顺序
- [ ] 约定用户图片输入的 block 排序与 Claude Code 一致：
  - 文字在前
  - 图片在后
- [ ] `systemPromptResolver` 与 `turnCompleteHook` 继续接收“用户文本 prompt”
- [ ] 当输入仅包含图片时，传给 resolver/hook 的 `userPrompt` 为空字符串

涉及文件：

- `src/core/queryEngine.ts`
- 可能涉及 `src/core/queryLoop.ts`
- 可能涉及 verbose / trace 的消息摘要代码

验收标准：

- `QueryEngine` 可提交 `ContentBlock[]` 形式的用户消息
- 消息持久化与恢复后，图片块顺序不丢失
- 不需要为多模态单独开一套 query loop

### 4.10 P2：REPL 多模态输入重构准备

这一阶段只做“准备”和“边界确认”，不在当前 `readline` REPL 上假装支持 Claude Code 的粘贴体验。

- [ ] 明确当前 `readline` REPL 不能对齐 Claude Code 的 paste/image path/clipboard 检测
- [ ] 评估是否需要将 interactive 输入层迁移到原始 TTY 事件流
- [ ] 评估未来是否引入：
  - bracketed paste 检测
  - 拖入图片路径识别
  - macOS 剪贴板图片读取
- [ ] 在真实输入层改造完成前，不对外宣称 interactive 已支持 Claude Code 级图片输入

涉及文件：

- `src/cli/repl.ts`
- `src/cli/interactive.ts`
- 未来可能新增专门的 interactive input handler

验收标准：

- 文档和实现边界一致
- 不会出现“headless 能发图，interactive 假装能发但实际丢图”的误导

### 4.11 P3：headless 模式显式图片输入入口

这条能力保留，但当前不进入近期主线。

- [ ] 为 `--print` 模式增加显式图片输入参数
- [ ] 首版建议采用重复参数形式：
  - `--image <path>`
- [ ] 支持多张图片，保持输入顺序
- [ ] 读取本地图片文件并编码为 base64 block
- [ ] 根据文件扩展名或 magic bytes 识别 `mediaType`
- [ ] 保持文字 prompt 与图片共同进入同一条用户消息
- [ ] 对路径不存在、非图片文件、读取失败给出明确错误

涉及文件：

- `src/cli/parseArgs.ts`
- `src/cli/headless.ts`
- 视需要新增 `src/cli/inputImages.ts` 或 `src/llm/imageInput.ts`

验收标准：

- 可以执行：
  - `dclaw --print --image ./a.png "解释这张图"`
  - `dclaw --print --image ./a.png --image ./b.jpg "比较这两张图"`
- 消息中真实包含图片 block，而不是把路径字符串塞给模型

## 5. 建议实施顺序

建议严格按下面顺序推进：

1. `P0` 消息模型
2. `P0` Anthropic provider
3. `P0` OpenAI Responses
4. `P0` OpenAI chat-completions 边界收紧
5. `P0` tool result 结构化多模态支持
6. `P0` WebFetch 远程图片读取链路
7. `P1` 本地图片读取工具链路
8. `P1` session / transcript / verbose 收口
9. `P2` QueryEngine 用户结构化输入
10. `P2` interactive 输入层重构准备
11. `P3` `--print --image`

## 6. 测试任务

### 6.1 单元测试

- [ ] `types/message`：
  - image block 类型与辅助函数
- [ ] `Anthropic provider`：
  - 正确映射图片 block
  - 超限图片被拦截
- [ ] `OpenAI provider`：
  - `responses` 正确映射图片输入
  - `chat-completions` 在含图片时行为明确
- [ ] `session/transcript`：
  - image block 可持久化
  - transcript 不泄露 base64
- [ ] `tool_result`：
  - 结构化图片结果不会被压扁
  - 文本型工具结果不回归
- [ ] `本地图片读取工具`：
  - 图片路径成功读取
  - 非图片/超限/不存在路径失败语义明确
- [ ] `远程图片读取工具`：
  - 图片 URL 成功下载并回传图片 block
  - 非图片 URL / 异常 content-type / 超限响应处理明确
- [ ] `QueryEngine`：
  - 可提交 `ContentBlock[]`
  - text-only 行为不回归
  - image-only 行为可工作
- [ ] `headless CLI`：
  - `--image` 解析
  - 多图顺序
  - 非法路径 / 非图片报错

### 6.2 集成测试

- [ ] 模型通过 `WebFetch` 读取远程图片并继续分析 smoke test
- [ ] 模型调用工具读取本地图片并继续分析 smoke test
- [ ] `resume` 后继续对包含历史图片的 session 发问
- [ ] `--print` + `Anthropic` 图片输入 smoke test
- [ ] `--print` + `OpenAI Responses` 图片输入 smoke test

## 7. 最小完成定义

以下条件同时满足，才算这条主线完成最小闭环：

- `dclaw` 的共享消息模型已支持 `image` block
- `Anthropic` provider 已支持图片透传
- `OpenAI Responses` 已支持图片透传
- `chat-completions` 含图片时边界明确
- `tool_result` 已支持结构化图片内容
- 模型可以通过 `WebFetch` 路径读取远程图片并继续分析
- 模型可以通过工具读取本地图片并继续分析
- session / resume / transcript 不丢结构、不泄露 base64

这是第一阶段完成定义。

第二阶段完成定义：

- `QueryEngine` 已支持结构化用户输入
- interactive 对话中的图片输入主路径已具备明确实现
- 工具链路与用户附图链路共用同一套消息级 image block 真值

第三阶段完成定义：

- `--print --image <path>` 可以工作

## 8. 后续扩展入口

等这条最小主线完成后，才允许评估后续扩展：

- interactive paste / drag path / clipboard image
- 图片缩放与下采样优化
- 更细的 provider 差异处理
- 更丰富的 transcript / verbose 摘要
- 更完整的工具产出多模态内容类型
- 更完整的 headless 多模态参数设计

在这些能力落地前，不提前扩写产品口径。
