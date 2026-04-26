# 多模态输入任务清单

相关正式设计文档：

- [多模态运行时与文档处理设计](./multimodal-runtime-design.md)
- [多模态运行时实施计划](./multimodal-runtime-implementation-plan.md)

状态说明（2026-04-25）：

- 配置与 runtime 主链路已经开始转向新架构
- 本文仍保留为历史任务清单和输入侧补充记录
- 涉及 `providers / runtimes / imageFallback / pdf / skill-first` 的最新口径，以前两份正式文档为准

## 1. 目标

为 `dclaw` 增加与 Claude Code 当前源码主路径尽量一致的多模态输入能力。

当前这项工作的严格边界：

- 只做消息级 `content blocks` 主路径
- OpenAI 与 Anthropic 保持相同能力模型
- 不额外发明通用附件系统
- 不顺手扩成 PDF、音频、视频、OCR、文件上传平台

记住我们的原则：无限靠拢 Claude Code 的实现，不额外加戏。（claudecode源码在本项目的src目录，与dclaw目录同级)

## 2. 当前实现状态

截至当前代码，第一阶段已经不再是“先做 provider 私有的图片型 `tool_result` 回传”，而是收敛到更统一的运行时方案：

- 用户图片输入已接入共享消息模型
- `Anthropic` 已支持用户消息里的 `text + image`
- `OpenAI Responses` 已支持用户消息里的 `text + image`
- `OpenAI chat-completions` 也已支持用户消息里的 `text + image`
- 工具返回图片时，会先持久化在 `tool_result.content`
- provider 侧仍只发送标准 `tool_result.output`
- runtime 会把当前可见消息中的图片型 `tool_result.content` 重建为下一轮临时 `user image message`
- `resume` 仍可依靠已持久化的 `tool_result.content` 恢复这条图片上下文
- `compact` 后不再每轮重扫全历史图片，而是仅在 freshly compacted session 上一次性恢复少量最近图片

这意味着当前的真实主路径已经变成：

1. 用户附图：
   - 输入层生成 `user message` 的 `text + image blocks`
   - provider 直接按标准多模态请求发送
2. 模型主动取远程图片：
   - 模型调用 `WebFetch`
   - `WebFetch` 返回标准文本 `output` 与结构化 `content`
   - runtime 将其中的图片内容提升为下一轮临时 `user image message`
   - 两家 provider 都按相同方式继续推理

另外，当前又补了一条受控降级链路：

3. 当前主 runtime 不支持视觉输入，但额外配置了 vision runtime：
   - `Read/WebFetch` 读到图片后，不再把 image block 直接交给当前主模型
   - 工具内部会触发一次最小 `vision side query`
   - side query 只吃：
     - 当前用户请求
     - 当前这次 tool use 的局部意图
   - side query 返回纯文本视觉观察结果
   - 主模型继续消费这段文本，而不是中途切换整个主会话 provider

## 3. 设计结论

根据当前代码与 Claude Code 对齐方向，真正的一等公民不是“附件”，而是统一消息模型：

- 用户消息 `content` 可以同时包含 `text` 与 `image`
- 图片在进入模型前会被整理成消息块
- 输入侧、会话侧、provider 侧都围绕同一份消息模型工作

同时要明确区分两层语义：

1. 持久化真值：
   - `Message.content`
   - `tool_result.output`
   - `tool_result.content`
2. 运行时桥接：
   - 对工具返回的图片，不直接依赖 provider 私有的“image inside tool_result”能力
   - 而是由 runtime 将 `tool_result.content` 重建成下一轮临时图片消息
   - compact 之后，这条桥接会收敛到“只看 boundary 后消息 + 一次性 post-compact 图片恢复”

这样做的原因是：

- `Anthropic` 虽然原生支持图片型 `tool_result`
- `OpenAI` 的标准 `tool result / tool message` 仍以文本输出为主
- 若继续依赖 provider 私有协议，OpenAI 和 Anthropic 的能力会分叉
- 统一改成 runtime 注入临时图片消息后，两家 provider 可以共享同一条能力主路径

对 `dclaw` 来说，当前最小且正确的落地顺序已经收敛为：

1. 共享消息模型支持 `image block`
2. provider 支持用户图片输入
3. `tool_result` 支持结构化 `content`
4. runtime 将工具图片结果转成临时图片消息
5. 远程图片读取优先复用 `WebFetch`
6. 后续再补本地图片读取与显式用户输入入口

## 4. 明确不做

以下内容当前明确不做：

- 通用 attachment 平台
- PDF 输入
- 音频输入
- 视频输入
- OCR / caption / 图像预摘要
- provider 文件上传中转
- 终端内图片预览 UI
- 在当前 `readline` REPL 上伪装 Claude Code 级粘贴体验
- 主 query loop 中途动态切换 provider
- 把 `vision side query` 扩写成通用多模态路由器

另外，下面这些不是“不做”，而是当前尚未进入已完成主线：

- 本地图片读取工具
- `QueryEngine` 公开结构化用户输入接口
- interactive 对话的图片输入
- `--print --image`

## 5. 任务拆解

### 5.1 P0：共享消息模型与基础观察面

- [x] 在 `src/types/message.ts` 增加图片消息块类型
- [x] 新增最小图片 source 结构：
  - `type: 'base64'`
  - `mediaType`
  - `data`
- [x] 将 `ContentBlock` 联合类型扩展为支持 `image`
- [x] 保持 `Message.content` 作为唯一真值
- [x] 不引入独立 `Attachment` / `Asset` / `Upload` 实体
- [x] transcript / history / verbose 遇到图片时输出受控占位，而不是刷出 base64
- [x] 共用图片大小校验逻辑

当前结果：

- 用户消息可以同时包含 `text` 和 `image`
- transcript / history 不再退化成完全不可辨识的 `[non-text content]`
- 文本-only 链路未被破坏

### 5.2 P0：Anthropic 与 OpenAI 的用户图片输入

- [x] `Anthropic` provider 支持用户消息里的 `text + image`
- [x] `OpenAI Responses` 支持用户消息里的 `text + image`
- [x] `OpenAI chat-completions` 也支持用户消息里的 `text + image`
- [x] 两家 provider 共用图片大小校验
- [x] 保留 block 顺序，不提前做本地图像理解

当前结果：

- `Anthropic` 请求体可以携带 base64 image block
- `OpenAI Responses API` 请求可以携带 `input_text + input_image`
- `OpenAI chat-completions` 请求可以携带 `text + image_url(data URL)` content parts

### 5.3 P0：工具结果支持结构化多模态 content

- [x] 将 `tool_result` 从“仅文本/JSON”扩展为可承载结构化 `content`
- [x] 当前 `tool_result.content` 至少可承载：
  - `text`
  - `image`
- [x] 现有纯文本/JSON tool result 保持兼容
- [x] query loop 会保留结构化 `tool_result.content`
- [x] trace / transcript / verbose 不输出原始 base64
- [x] `tool result budget` 不会错误持久化或替换带图片内容的结果

当前结果：

- `tool_result.content` 已成为 runtime 级桥接数据
- provider 侧不再直接依赖“图片型 tool_result”协议
- 现有文本型工具无需跟着大改

### 5.4 P0：runtime 统一桥接工具图片结果

- [x] 新增 runtime 桥接层，从历史消息扫描 `tool_result.content`
- [x] 将图片工具结果重建为下一轮临时 `user image message`
- [x] Anthropic 与 OpenAI 都继续只接收标准文本型 `tool_result.output`
- [x] 不引入 provider-specific shim

当前结果：

- `Anthropic` 与 `OpenAI` 保持相同能力模型
- “工具读图后继续分析”不再依赖 provider 私有能力
- 图片工具结果不会污染持久 transcript 展示，但会继续参与后续模型推理

### 5.5 P0：远程图片读取工具链路，优先 WebFetch

- [x] 复用 `WebFetch` 的请求/权限/重定向主链路
- [x] 支持从 URL 下载远程图片
- [x] 校验协议、content-type、大小限制
- [x] 明确下载超时与失败语义
- [x] 对支持的远程图片返回：
  - 标准文本 `output`
  - 结构化 `text + image content`
- [x] 非图片 URL 不会被静默当成图片
- [x] 不在第一版引入缓存、对象存储、临时上传中心等机制

当前边界：

- 当前仅支持受控远程图片类型：
  - `image/jpeg`
  - `image/png`
  - `image/gif`
  - `image/webp`
- `svg` 等 image-like 资源当前明确不支持

### 5.6 P0：会话持久化、resume、compact 与观察面

- [x] `messages.jsonl` 可持久化 `image block`
- [x] `tool_result.content` 会随 session 一并持久化
- [x] `resume` 后图片工具结果可继续被重建为临时图片消息
- [x] `compact` 后首轮可通过受控的 post-compact 图片恢复继续分析最近图片
- [x] transcript / history / verbose 继续只输出受控摘要

当前结果：

- 当前已经不再依赖“compact 后每轮重扫全历史图片”
- 当前更接近 Claude Code 的做法：
  - 正常轮次只从当前可见消息恢复图片型 `tool_result`
  - freshly compacted session 只一次性恢复少量最近图片
  - 图片恢复同时受数量与总预算约束

### 5.7 P1：本地图片读取链路，收敛到扩展现有 Read

这一阶段已经收敛方向并落了首版实现：

- [x] 重新对齐 Claude Code 源码后，确认本地多模态文件读取主路径应扩展现有 `Read`
- [x] 不新增独立 `ReadImage` / `OpenImage` 工具
- [x] `Read` 已支持受控本地图片类型：
  - `image/jpeg`
  - `image/png`
  - `image/gif`
  - `image/webp`
- [x] 加入本地图片大小限制与 media type 识别
- [x] 对超限图片与无法识别的图片内容给出明确错误
- [x] 图片读取结果继续复用现有 `tool_result.content -> runtime 临时图片消息` 主路径
- [x] 保持 `Read` 的权限语义与现有文件读取工具一致
- [x] 明确收紧 `offset / limit` 边界：仅适用于文本读取，不适用于图片文件

当前结果：

- 模型可以通过现有 `Read` 工具读取本地图片
- 图片读取结果会返回：
  - 标准 `output.type = "image"` 元数据
  - 结构化 `tool_result.content` 中的图片 block
  - 额外的补充文本消息，走更接近 Claude Code 的 `tool -> newMessages` 追加消息路径
- 不需要用户手工先把图片转 base64 再贴给 agent

当前仍需继续评估的收口点：

- `dclaw` 已补上最小 `tool -> newMessages` 机制，并先用于本地图片 `Read` 的补充文本消息；但当前仍只在少数多模态场景使用，还没有像 Claude Code 那样系统性接到 PDF/更多工具类型
- 当前 `Read` 已显式拒绝在图片文件上使用 `offset / limit`，避免静默忽略参数。后续仍可继续评估是否要进一步向 Claude Code 的统一多媒体参数语义靠拢
- 当前 `tool result budget` 会跳过带结构化 `content` 的图片结果，不会把这类结果持久化替换成磁盘引用。这样能避免破坏图片继续分析链路，但也意味着后续仍要继续评估是否需要更接近 Claude Code 的多模态 budget / attachment 策略

### 5.8 P1：tool result budget 与图片结果的融合评估

这一阶段已经完成源码对齐结论，并落了第一版运行时收口。

- [x] 重新核对 Claude Code 源码中 `tool result budget`、`FileReadTool`、`compact`、`attachments` 相关实现
- [x] 确认 Claude Code 不会把带 `image block` 的 `tool_result` 纳入文本型 budget 持久化替换
- [x] 确认 Claude Code 的图片预算主约束在读图阶段，而不是在 `tool_result` 持久化阶段
- [x] 确认 Claude Code 在 compact 后更偏向通过 `file attachments` 恢复近期文件上下文，而不是继续依赖原始 `tool_result` 重扫
- [x] 停止 `dclaw` 在 compact 后每轮重扫全历史图片型 `tool_result`
- [x] 为 `dclaw` 增加更接近 Claude Code 的一次性 post-compact 图片恢复
- [x] 将 post-compact 图片恢复收紧为“最近少量 + 总预算受控”
- [x] 评估 `Read` / `WebFetch` 是否需要像 Claude Code 一样更明确地收敛为“工具自带预算，budget 层不再碰图片”

当前结论：

- Claude Code 对图片结果采用的是“分层处理”，不是让现有文本型 `tool result budget` 直接处理图片
- 第一层是读图阶段预算：
  - `Read` 图片时先做 resize / downsample / token budget 控制
  - 图片过大时优先压缩，而不是在后续 `tool_result` 阶段改写
- 第二层是 `tool result budget`：
  - 明确跳过带 `image block` 的 `tool_result`
  - 文本大结果才会被持久化替换成 preview
- 第三层是 compact / 恢复：
  - Claude Code 更接近通过 `file attachments` 恢复最近读过的图片/文件上下文
  - `dclaw` 现在也开始朝这个方向收口：compact 后只一次性恢复少量最近图片，并且受总预算限制，而不是每轮重扫全历史

对 `dclaw` 当前实现的含义：

- 当前 `tool result budget` 跳过图片结果，这一点已经与 Claude Code 大方向一致
- 当前 `compact / resume` 恢复策略已经更接近 Claude Code：
  - `resume` 仍可依赖持久化 `tool_result.content`
  - `compact` 已不再走全历史图片回灌，而是改成按数量与预算受控的一次性恢复
- 当前 `Read` / `WebFetch` 的图片路径已经满足“工具自带预算，budget 层不碰图片”：
  - `Read` / `WebFetch` 图片现在都先走 resize / downsample
  - 两者都会按 Claude Code 同款近似公式先估图片 token：`estimatedTokens ~= base64Chars * 0.125`
  - 当常规 resize 后仍超图片 token budget 时，会继续做更激进压缩，而不是直接把原图交给 provider
  - 图片 token budget 与 source image 上限已经收敛到共享 `readLimits` 入口，不再散落在图片 helper 内部
  - 两者都先用较宽松的 source image 上限收口，再对实际附给模型的图片负载做优化
  - 两者返回图片时都会走结构化 `content`
  - 当前 `tool result budget` 只处理没有结构化 `content` 的纯文本型结果，因此不会碰图片结果
- 这让 `dclaw` 更接近 Claude Code 的真实分层：
  - 图片预算优先在读图阶段解决
  - budget 层继续只管文本型大结果
- 因此不建议把 `Read` / `WebFetch` 整体改成 `maxResultSizeChars = Infinity`
  - 否则会连它们的文本路径一起绕开 budget
  - 这会削弱大文本读取/抓取结果的收口能力，也不符合我们当前更细粒度的实现
- 所以下一步不应是“把图片塞进现有文本型 budget 做持久化替换”
- 下一步更值得评估的是“是否要继续把这条一次性图片恢复扩展成更完整的 multimodal attachment restore”

### 5.9 P1：text-only 主 runtime 的 `vision side query` 降级路径

这一阶段已落最小主路径。

- [x] 不引入“主会话中途切 provider”的 failover 方案
- [x] 当前主 runtime 不支持视觉输入时，允许额外配置独立 `vision runtime`
- [x] 首版只覆盖：
  - `Read(image)`
  - `WebFetch(image)`
- [x] side query 只吃最小上下文：
  - 当前用户请求
  - 当前这次 tool use 的局部意图
- [x] 当前 `toolUseIntent` 已按固定顺序提取：
  - 最近 assistant 可见文本
  - 若无，则同轮 reasoning/thinking
  - 若再无，则最近用户请求
- [x] side query 返回纯文本视觉观察结果，再作为普通文本 tool result 继续喂回主流程
- [x] 当前主 runtime 不支持视觉输入、且也未配置 vision runtime 时，会在 `Read/WebFetch(image)` 上显式报错，而不是静默返回主模型无法消费的 image block

当前结果：

- 主 query loop 仍保持单 provider 主线，不会因为某一次读图就把整段会话切到另一个 provider
- 图片降级分析发生在工具层，而不是让模型自己猜“现在要不要切视觉模型”
- side query prompt 当前只做最小事实提取，不做代码生成、实现决策或全局会话摘要
- `Read/WebFetch(image)` 的图片路径现在具备两种受控模式：
  - 主 runtime 支持视觉：继续返回结构化 image content
  - 主 runtime 不支持视觉，但配置了 vision runtime：改走 side query，返回文本观察结果

当前边界：

- 还没有扩到用户直接附图、interactive 图片输入、`--print --image`
- 还没有扩成通用“任何图片来源都自动 side query”的全局机制
- 还没有为 side query 引入更复杂的任务分类器；当前只保留最小 intent fallback
- 还没有像 Claude Code 那样提供一套“主模型天然多模态”的统一假设；这条链路本质上是 `dclaw` 针对 text-only runtime 的受控降级

### 5.10 P2：QueryEngine 输入面支持结构化用户消息

这一阶段仍未开工。

- [ ] 将 `QueryEngine.submitUserPrompt()` 从只接收 `string` 扩展为支持结构化输入
- [ ] `submitUserPromptWithHandlers()` 同步支持结构化输入
- [ ] 引入最小输入类型，例如：
  - `string`
  - `ContentBlock[]`
- [ ] 用户消息入库时保留原始 block 顺序
- [ ] 约定用户图片输入的 block 排序与 Claude Code 一致：
  - 文字在前
  - 图片在后

验收标准：

- `QueryEngine` 可提交 `ContentBlock[]` 形式的用户消息
- 消息持久化与恢复后，图片块顺序不丢失
- 不需要为多模态单独开一套 query loop

### 5.11 P2：REPL 多模态输入重构准备

这一阶段仍未开工。

- [ ] 明确当前 `readline` REPL 不能对齐 Claude Code 的 paste / image path / clipboard 检测
- [ ] 评估是否需要将 interactive 输入层迁移到原始 TTY 事件流
- [ ] 评估未来是否引入：
  - bracketed paste 检测
  - 拖入图片路径识别
  - macOS 剪贴板图片读取
- [ ] 在真实输入层改造完成前，不对外宣称 interactive 已支持 Claude Code 级图片输入

### 5.12 P3：headless 模式显式图片输入入口

这条能力保留，但当前不进入近期主线。

- [ ] 为 `--print` 模式增加显式图片输入参数
- [ ] 首版建议采用重复参数形式：
  - `--image <path>`
- [ ] 支持多张图片，保持输入顺序
- [ ] 读取本地图片文件并编码为 base64 block
- [ ] 根据文件扩展名或 magic bytes 识别 `mediaType`
- [ ] 保持文字 prompt 与图片共同进入同一条用户消息
- [ ] 对路径不存在、非图片文件、读取失败给出明确错误

## 6. 建议实施顺序

当前建议顺序已经更新为：

1. 已完成：共享消息模型与图片校验
2. 已完成：Anthropic / OpenAI 用户图片输入
3. 已完成：`tool_result.content` 结构化多模态支持
4. 已完成：runtime 将工具图片结果转成临时图片消息
5. 已完成：`WebFetch` 远程图片读取链路
6. 已完成：session / resume / compact / transcript 收口
7. 已完成：本地图片读取链路收敛到扩展现有 `Read`
8. 已完成：text-only 主 runtime 的 `vision side query` 降级路径
9. 待做：`QueryEngine` 公开结构化用户输入
10. 待做：interactive 输入层重构准备
11. 待做：`--print --image`

## 7. 测试状态

### 7.1 已补齐的回归

- [x] `types/message`：
  - image block 类型与辅助函数
- [x] `Anthropic provider`：
  - 正确映射用户图片 block
  - 超限图片被拦截
- [x] `OpenAI provider`：
  - `responses` 正确映射图片输入
  - `chat-completions` 正确映射图片输入
- [x] `session/transcript`：
  - image block 可持久化
  - transcript 不泄露 base64
- [x] `tool_result`：
  - 结构化图片结果不会被压扁
  - provider 只继续序列化标准 `tool_result.output`
- [x] `WebFetch`：
  - 支持的远程图片可成功下载并返回结构化内容
  - 非支持 image-like media type 会返回结构化 unsupported 结果
- [x] `Read / WebFetch` 文档边界：
  - `pdf / docx / xlsx / binary` 已走共享内容分类
  - unsupported 情况会返回结构化字段和稳定文字说明
- [x] `Read / WebFetch` 的 `vision side query`：
  - 当前主 runtime 不支持视觉输入时，可改走 side query
  - `toolUseIntent` 会按 `assistant text -> reasoning/thinking -> user request` 顺序回退
- [x] `QueryEngine`：
  - 工具图片结果会被注入为临时图片消息
  - `compact` 后仍可恢复
  - `resume` 后仍可恢复
- [x] `Read` 本地图片：
  - 支持本地图片读取
  - 显式拒绝图片文件上的 `offset / limit`
  - 通过 `tool -> newMessages` 追加补充文本消息

### 7.2 仍待补齐的测试

- [ ] budget / compact 与图片结果融合策略的后续实现
- [ ] 更接近 Claude Code 的 multimodal attachment restore
- [ ] `QueryEngine` 结构化用户输入接口
- [ ] `headless CLI --image`
- [ ] interactive 图片输入

## 8. 最小完成定义

当前已经完成的第一阶段闭环：

- `dclaw` 的共享消息模型已支持 `image` block
- `Anthropic` provider 已支持用户图片输入
- `OpenAI Responses` 已支持用户图片输入
- `OpenAI chat-completions` 已支持用户图片输入
- `tool_result` 已支持结构化图片内容
- runtime 已能把工具图片结果转成下一轮临时图片消息
- 模型可以通过 `WebFetch` 路径读取远程图片并继续分析
- 模型可以通过现有 `Read` 工具读取本地图片并继续分析
- 当主 runtime 不支持视觉输入、但存在独立 vision runtime 时，`Read/WebFetch(image)` 已可通过 `vision side query` 降级为文本视觉观察
- `session / compact / resume / transcript` 不丢结构、不泄露 base64

当前尚未完成的第二阶段：

- `tool result budget / compact` 与多模态结果进一步向 Claude Code 靠拢
- `QueryEngine` 已支持公开的结构化用户输入
- interactive 对话中的图片输入主路径具备明确实现
- `--print --image <path>` 可以工作

## 9. 后续扩展入口

等第二阶段主线完成后，才允许评估后续扩展：

- interactive paste / drag path / clipboard image
- 图片缩放与下采样优化
- 更接近 Claude Code 的 post-compact multimodal attachment 恢复
- 更细的 provider 差异处理
- 更丰富的 transcript / verbose 摘要
- 更完整的工具产出多模态内容类型
- 更完整的 headless 多模态参数设计

在这些能力落地前，不提前扩写产品口径。
