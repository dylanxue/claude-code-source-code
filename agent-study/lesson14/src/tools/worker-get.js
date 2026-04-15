export function createWorkerGetTool({ getWorker }) {
  if (typeof getWorker !== "function") {
    throw new Error("createWorkerGetTool requires a getWorker(input, context) function.");
  }

  return {
    name: "WorkerGet",
    family: "worker",
    description: "Fetch the current worker boot state, last error, and event history.",
    inputSchema: {
      type: "object",
      required: ["worker_id"],
      properties: {
        worker_id: {
          type: "string",
          description: "Worker identifier returned by WorkerCreate.",
        },
      },
    },
    async execute(input, context) {
      return getWorker(input, context);
    },
  };
}
