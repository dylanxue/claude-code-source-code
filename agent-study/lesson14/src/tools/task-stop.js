import { stopRegisteredTask } from "../core/task-registry.js";

export const taskStopTool = {
  name: "TaskStop",
  family: "task",
  description: "Stop a running background task by ID.",
  inputSchema: {
    type: "object",
    required: ["task_id"],
    properties: {
      task_id: {
        type: "string",
        description: "Task identifier returned by the task registry.",
      },
    },
  },
  async execute(input, context) {
    const task = stopRegisteredTask(context.workspaceRoot, input.task_id, {
      sessionId: context.sessionId,
    });
    return {
      task_id: task.taskId,
      status: task.status,
      message: "Task stopped",
    };
  },
};
