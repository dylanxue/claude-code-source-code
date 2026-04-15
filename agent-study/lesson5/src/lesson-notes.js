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
  ],
};
