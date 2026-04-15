# Lesson 11: Web Search / Web Fetch

这一课承接 `lesson10`，但重点不再是继续观察 runtime decision loop。

`lesson10` 已经把 runtime 的 stop / continue 轨迹显式化了，接下来我们要解决另一个很实际的问题：

- 当回答需要 `workspace` 外的知识时，agent 应该怎么办？

参考 Claude Code，这件事不应该主要靠 `bash` 去读系统路径、猜上级目录、或者把 shell 当成外部知识入口。更合理的做法是给 agent 一组显式的外部信息工具。

所以 `lesson11` 的主题是：

- `WebSearch`
- `WebFetch`

## 当前目标

lesson11 主要做三件事：

1. 给 agent 增加显式的 workspace 外知识入口
2. 让 mock / smoke / 测试都能验证这套工具闭环
3. 把课程口径收敛成：需要外部知识时，优先走专用工具，不把 shell 当兜底

## 当前实现

现在 lesson11 新增了两个工具：

- `WebSearch`
  搜索网络结果，返回摘要和结构化 hits
- `WebFetch`
  抓取指定 URL，把 HTML 转成可读文本，再围绕 prompt 生成摘要

这两个工具都直接参考了 Claude Code 的 Rust 工具层：

- `rust/crates/tools/src/lib.rs`

同时 app 启动时也会明确提示模型：

- 需要当前信息或 workspace 外事实时，优先用 `WebSearch / WebFetch`
- 不要把 `bash` 当成跨边界外部知识通道

## 为什么这一步重要

前面几课我们一直在把文件工具和 shell 工具收敛到更像真实 coding agent 的形态。

但只要系统里没有合法的“外部知识入口”，模型就很容易出现两种坏倾向：

- 明明问题超出了当前 workspace，还在本地目录里盲找
- 试图用 `bash` 去绕开文件工具边界

lesson11 做的事情很简单，但很关键：

- 给 agent 一个正当的 workspace 外信息源
- 让 runtime / prompt / tool contract 一起表达这个边界

## 当前课程口径

lesson11 的定位可以压成一句话：

- `Use explicit external-knowledge tools instead of shell workarounds`

也就是：

- `workspace` 内问题优先走 `read_file / grep_search / glob_search`
- 当前信息或网页内容优先走 `WebSearch / WebFetch`
- shell 继续保留，但不再承担“跨边界找知识”的主要职责

## 推荐实验

```bash
cd agent-study/lesson11
npm test
```

```bash
cd agent-study/lesson11
npm run smoke
```

```bash
cd agent-study/lesson11
npm start -- "搜索网络上关于 Model Context Protocol 的最新资料"
```

```bash
cd agent-study/lesson11
npm start -- "抓取网页 https://example.com 并总结内容"
```

## 传输层调优

lesson11 现在也补了最小的模型层 `fail fast + bounded retry`，主要用于 OpenAI-compatible adapter：

- `LLM_REQUEST_TIMEOUT_MS`
  整次请求的总超时
- `LLM_FIRST_BYTE_TIMEOUT_MS`
  等待首包的 fail-fast 超时
- `LLM_STREAM_IDLE_TIMEOUT_MS`
  流式响应在两段 chunk 之间的空闲超时
- `LLM_RETRY_LIMIT`
  可重试错误的最大重试次数
- `LLM_RETRY_BACKOFF_MS`
  重试前的基础退避时间

当前策略是：

- 超时、网络抖动、`429/5xx` 这类临时性错误可以重试
- 只有在还没向用户流出正文内容时才会自动重试，避免重复输出半截回答

## 当前判断标准

如果 lesson11 的方向是对的，应该看到这些结果：

- agent 有了显式的外部知识工具，而不是只剩 `bash`
- `WebSearch` 返回可引用的结构化结果
- `WebFetch` 能把网页转成可读文本并围绕 prompt 生成摘要
- 当前课程更清楚地区分了：
  - workspace 内知识
  - workspace 外知识
  - shell 执行能力

## 下一步候选

lesson11 之后，最自然的后续主题有三条：

- `ToolSearch / Skill / Agent`
- `MCP / ReadMcpResource`
- `Pinned Context / Retained Messages`

但在进入下一课之前，lesson11 先把 “agent 如何合法获取 workspace 外知识” 这件事补上了。
