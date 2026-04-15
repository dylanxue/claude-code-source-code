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
  ],
};
