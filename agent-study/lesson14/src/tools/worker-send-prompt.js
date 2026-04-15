export function createWorkerSendPromptTool({ sendWorkerPrompt }) {
  if (typeof sendWorkerPrompt !== "function") {
    throw new Error(
      "createWorkerSendPromptTool requires a sendWorkerPrompt(input, context) function.",
    );
  }

  return {
    name: "WorkerSendPrompt",
    family: "worker",
    description:
      "Send a task prompt only after the worker reaches ready_for_prompt; can replay a recovered prompt.",
    inputSchema: {
      type: "object",
      required: ["worker_id"],
      properties: {
        worker_id: {
          type: "string",
          description: "Worker identifier returned by WorkerCreate.",
        },
        prompt: {
          type: "string",
          description: "Optional prompt override. If omitted, the stored prompt is replayed.",
        },
      },
    },
    async execute(input, context) {
      return sendWorkerPrompt(input, context);
    },
  };
}
