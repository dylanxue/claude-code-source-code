import { appendRegisteredTaskMessageForSession } from "../core/task-registry.js";

export const taskUpdateTool = {
  name: "TaskUpdate",
  family: "task",
  description: "Send a message or update to a running background task.",
  inputSchema: {
    type: "object",
    required: ["task_id", "message"],
    properties: {
      task_id: {
        type: "string",
        description: "Task identifier returned by the task registry.",
      },
      message: {
        type: "string",
        description: "Follow-up message to append to the task history.",
      },
    },
  },
  async execute(input, context) {
    const task = appendRegisteredTaskMessageForSession(
      context.workspaceRoot,
      input.task_id,
      input.message,
      "user",
      { sessionId: context.sessionId ?? null },
    );
    return {
      task_id: task.taskId,
      status: task.status,
      message_count: task.messages.length,
      last_message: input.message,
    };
  },
};
