export function createWorkerAwaitReadyTool({ awaitWorkerReady }) {
  if (typeof awaitWorkerReady !== "function") {
    throw new Error(
      "createWorkerAwaitReadyTool requires an awaitWorkerReady(input, context) function.",
    );
  }

  return {
    name: "WorkerAwaitReady",
    family: "worker",
    description: "Return the current ready-handshake verdict for a coding worker.",
    inputSchema: {
      type: "object",
      required: ["worker_id"],
      properties: {
        worker_id: {
          type: "string",
          description: "Worker identifier returned by WorkerCreate.",
        },
        timeout_ms: {
          type: "number",
          description: "Optional max wait time before returning the current worker state.",
        },
        poll_interval_ms: {
          type: "number",
          description: "Optional poll interval while waiting for readiness.",
        },
      },
    },
    async execute(input, context) {
      return awaitWorkerReady(input, context);
    },
  };
}
