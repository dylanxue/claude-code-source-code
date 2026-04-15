export function createWorkerCreateTool({ createWorker }) {
  if (typeof createWorker !== "function") {
    throw new Error("createWorkerCreateTool requires a createWorker(input, context) function.");
  }

  return {
    name: "WorkerCreate",
    family: "worker",
    description:
      "Create a worker lane with an explicit ready-for-prompt handshake before the delegated prompt is delivered.",
    inputSchema: {
      type: "object",
      required: ["description", "prompt"],
      properties: {
        description: {
          type: "string",
          description: "Short summary of the delegated worker task.",
        },
        prompt: {
          type: "string",
          description: "Initial prompt to store for later prompt delivery.",
        },
        subagent_type: {
          type: "string",
          description: "Optional worker role, such as Explore, Plan, general-purpose, or Verification.",
        },
        name: {
          type: "string",
          description: "Optional stable display name for the worker lane.",
        },
        model: {
          type: "string",
          description: "Optional model override for the worker lane.",
        },
      },
    },
    async execute(input, context) {
      return createWorker(input, context);
    },
  };
}
