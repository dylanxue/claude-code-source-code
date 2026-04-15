# 第 2 课：从最小 Agent 到真正的 Tooling Layer

这一课的目标不是接入真正的大模型，而是先把 agent 的“执行层”搭得更像样。

## 新增了什么

### 1. Tool schema

第 1 课里，工具只是普通函数。

第 2 课开始，每个工具都带：

- `name`
- `description`
- `inputSchema`
- `execute(input, context)`

这一步非常关键，因为真正的 LLM tool calling 也依赖类似结构。

### 2. 三个核心工具

- `grep_text`
  用来做代码检索，先缩小范围
- `read_file`
  用来读取上下文
- `write_file`
  用来产出结果
- `bash`
  用来执行外部命令

这几类工具基本覆盖了 coding agent 的最小执行面。

### 3. Runtime 记录工具失败

真实 agent 不能假设工具永远成功。

所以我们在 runtime 里把工具失败也写进 session，这样模型下一步还能“看见失败”，决定是否重试、换工具、或者向用户解释。

## 对应到 Claude Code 的学习映射

- `src/tool_pool.py`
  对应我们的 `src/core/tool-registry.js`
- `rust/crates/tools/`
  对应我们的 `src/tools/*.js`
- `rust/crates/runtime/src/conversation.rs`
  对应我们的 `src/core/agent-runtime.js`
- `rust/crates/runtime/src/permissions.rs`
  这一课只做了最小影子，后面会继续完善

## 推荐自己试的 prompt

```bash
cd agent-study/lesson2
npm start -- "查找 src 里和 tool 相关的内容"
```

```bash
cd agent-study/lesson2
npm start -- "请把 hello from lesson2 写入 notes.txt"
```

```bash
cd agent-study/lesson2
npm start -- "运行 `pwd`"
```

## 这一课最重要的理解

coding agent 的真正门槛，通常不在“怎么调一次 LLM API”，而在：

- 如何设计工具协议
- 如何维护多步状态
- 如何让失败可恢复
- 如何逐渐引入安全约束
