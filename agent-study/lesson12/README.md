# Lesson 12: ToolSearch / Capability Discovery

这一课承接 `lesson11`，但重点不再是继续扩外部知识工具。

`lesson11` 已经补上了 `WebSearch / WebFetch`，接下来更真实的问题是：

- 工具越来越多之后，模型怎么知道“该用哪个”？

参考 Claude Code，这件事不应该只靠系统 prompt 里硬塞一串工具名，也不应该完全靠模型记忆。更合理的做法是把“能力发现”本身做成一个显式工具。

所以 `lesson12` 的主题是：

- `ToolSearch`

## 当前目标

lesson12 主要做三件事：

1. 给 agent 增加显式的工具发现能力
2. 让 registry 不只是执行工具，还能暴露可搜索的能力元数据
3. 把课程口径收敛成：工具面变大后，先发现能力，再调用能力

## 当前实现

现在 lesson12 新增了一个工具：

- `ToolSearch`
  按工具名、family、description 搜索当前可用工具，并返回最匹配的工具名列表

它参考的是 Claude Code Rust 工具层里的：

- `rust/crates/tools/src/lib.rs`

当前返回 shape 也尽量贴近 Rust：

- `matches`
- `query`
- `normalized_query`
- `total_deferred_tools`
- `pending_mcp_servers`

同时 app 启动时也会明确提示模型：

- 当你不确定该用哪个工具时，先用 `ToolSearch`

## 为什么这一步重要

前面几课我们已经把工具面明显扩大了：

- 文件工具
- shell 工具
- web 工具

如果继续这样加下去，但不补“能力发现”层，模型就会越来越容易出现这些问题：

- 记错工具名
- 明明有专用工具，却先走 `bash`
- 工具多了以后只能靠 prompt 里的一大段说明硬撑

lesson12 补的不是一个“更强工具”，而是一个更稳定的工具选择入口。

## 当前课程口径

lesson12 的定位可以压成一句话：

- `Discover capabilities before guessing tool names`

也就是：

- 问题明确、工具明确时，直接调用
- 问题模糊、工具面较大时，先用 `ToolSearch`
- tool registry 不再只是执行器，也开始承担“可发现性”

## 推荐实验

```bash
cd agent-study/lesson12
npm test
```

```bash
cd agent-study/lesson12
npm run smoke
```

```bash
cd agent-study/lesson12
npm start -- "我想找一个适合搜索工具能力的 tool，用什么工具？"
```

```bash
cd agent-study/lesson12
npm start -- "如果我要获取网页内容，当前有哪些相关工具？"
```

## 当前判断标准

如果 lesson12 的方向是对的，应该看到这些结果：

- agent 有了显式的能力发现入口，而不是只靠 prompt 和记忆
- `ToolSearch` 能稳定找到 `WebSearch / WebFetch / read_file / bash` 这类能力
- registry 从“能执行”推进到“能被搜索”
- 新工具不会破坏 lesson11 已有的 web / file / shell 主链路

## 下一步候选

lesson12 之后，最自然的后续主题有两条：

- `Skill / Agent`
- `MCP / ReadMcpResource`

但在进入下一课之前，lesson12 先把 “agent 如何发现自己会什么” 这件事补上了。
