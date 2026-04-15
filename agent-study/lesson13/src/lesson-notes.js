export const lessonNotes = {
  architecture: [
    {
      clawCode: "src/tool_pool.py",
      nodeVersion: "src/core/tool-registry.js",
      takeaway: "先有统一的工具注册中心，agent 才能稳定地发现和调用工具。",
    },
    {
      clawCode: "src/bootstrap_graph.py",
      nodeVersion: "src/bootstrap/create-agent-app.js",
      takeaway: "启动阶段本质上是依赖装配，不应该把业务逻辑塞进 CLI 入口。",
    },
    {
      clawCode: "rust/crates/runtime/src/conversation.rs",
      nodeVersion: "src/core/agent-runtime.js",
      takeaway: "真正的 agent 核心是循环，不是一次性 prompt。",
    },
    {
      clawCode: "rust/crates/runtime/src/session.rs",
      nodeVersion: "src/core/session.js",
      takeaway: "会话是 runtime 的状态容器，后续记忆、压缩、恢复都建立在它之上。",
    },
    {
      clawCode: "rust/crates/tools/",
      nodeVersion: "src/tools/*.js",
      takeaway: "第二课开始把工具从 demo 升级成可扩展的执行层，并给工具补输入 schema。",
    },
    {
      clawCode: "rust/crates/runtime/src/permissions.rs",
      nodeVersion: "src/tools/bash.js",
      takeaway: "这一课先做最小安全检查，下一课再继续完善权限系统。",
    },
    {
      clawCode: "rust/crates/api/",
      nodeVersion: "src/model/openai-responses-model.js",
      takeaway: "第三课把模型层独立成 adapter，让 agent runtime 不依赖具体厂商协议。",
    },
    {
      clawCode: "rust/crates/runtime/src/conversation.rs",
      nodeVersion: "src/core/agent-runtime.js",
      takeaway: "真实 tool calling 需要把 tool_call_id 保存在会话里，下一轮才能把 tool output 正确回传给模型。",
    },
    {
      clawCode: "rust/crates/runtime/src/session.rs",
      nodeVersion: "src/core/session.js + src/core/session-store.js",
      takeaway: "第四课开始把 session 从内存对象升级成可持久化状态，支持落盘和 resume。",
    },
    {
      clawCode: "rust/crates/runtime/src/compact.rs",
      nodeVersion: "src/core/session-compaction.js",
      takeaway: "第五课开始给 session 加 compaction，把旧上下文压成 summary，同时保留最近消息继续工作。",
    },
    {
      clawCode: "rust/crates/runtime/src/conversation.rs + rust/crates/tools/src/lib.rs",
      nodeVersion: "src/model/anthropic-messages-model.js + src/model/streaming-sse.js",
      takeaway: "第六课开始把整包响应升级成 streaming event 解析，向 Claude Code 的 event-driven runtime 靠近。",
    },
    {
      clawCode: "rust/crates/runtime/src/conversation.rs + rust/crates/runtime/src/usage.rs + rust/crates/runtime/src/summary_compression.rs",
      nodeVersion: "src/core/agent-runtime.js + src/core/session-compaction.js",
      takeaway: "第七课开始把 compaction 从教学版机制推进到真实 usage 驱动、forced compact 兜底和 LLM summary 的硬化阶段。",
    },
    {
      clawCode: "rust/crates/runtime/src/summary_compression.rs + rust/crates/runtime/src/bash.rs + rust/crates/runtime/src/prompt.rs",
      nodeVersion: "src/core/session-compaction.js + src/tools/*.js + src/core/agent-runtime.js",
      takeaway: "第八课继续把上下文预算控制做成系统能力，不只在 compact 时压缩，还要控制超大工具输出如何进入 session。",
    },
    {
      clawCode:
        "rust/crates/runtime/src/mcp_tool_bridge.rs + rust/crates/runtime/src/prompt.rs + Claude Code hooks/skills/tool-search design",
      nodeVersion: "src/core/tool-registry.js + src/core/agent-runtime.js + src/core/pre-tool-use-hooks.js",
      takeaway:
        "第九课最终收敛成事实型 tool signals + 最小 PreToolUse guardrail，让 runtime 更像 orchestration；tool 自己返回事实字段，tool result 直接进入 session，长上下文再交给 compaction 处理。",
    },
    {
      clawCode:
        "rust/crates/runtime/src/conversation.rs + event/reporting flow in Claude Code runtime",
      nodeVersion: "src/core/agent-runtime.js + src/index.js",
      takeaway:
        "第十课开始把 runtime orchestration 显式化：每轮的 model decision、tool batch 结果和 stop/continue 判断都整理成 decision journal，并通过 runtime event 暴露出来，方便观察 agent 为什么继续、为什么停。",
    },
    {
      clawCode:
        "rust/crates/tools/src/lib.rs (WebFetch / WebSearch) + rust/crates/runtime/src/prompt.rs",
      nodeVersion: "src/tools/web-fetch.js + src/tools/web-search.js + src/bootstrap/create-agent-app.js",
      takeaway:
        "第十一课开始给 agent 增加显式的 workspace 外知识入口：需要当前信息或外部网页时，优先走 WebSearch / WebFetch，而不是把 bash 当成跨边界兜底工具。",
    },
    {
      clawCode:
        "rust/crates/tools/src/lib.rs (ToolSearch) + Claude Code capability discovery pattern",
      nodeVersion: "src/tools/tool-search.js + src/core/tool-registry.js + src/bootstrap/create-agent-app.js",
      takeaway:
        "第十二课开始把能力发现做成显式工具：当工具面越来越大时，agent 不该只靠 prompt 和记忆去猜工具名，而要先用 ToolSearch 检索当前可用能力。",
    },
    {
      clawCode:
        "rust/crates/tools/src/lib.rs (Skill) + commands skill lookup roots",
      nodeVersion: "src/tools/skill.js + src/bootstrap/create-agent-app.js",
      takeaway:
        "第十三课开始把本地可复用工作流做成显式 Skill：agent 可以按 claw-code 风格在项目目录、~/.codex/skills 和兼容 commands 目录里解析 SKILL.md，而不是每次都临时拼装流程。",
    },
  ],
};
