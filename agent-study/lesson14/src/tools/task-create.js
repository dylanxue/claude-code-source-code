import { createRegisteredPromptTask } from "../core/task-registry.js";

export const taskCreateTool = {
  name: "TaskCreate",
  family: "task",
  description: "Create a background task that runs in a separate subprocess.",
  inputSchema: {
    type: "object",
    required: ["prompt"],
    properties: {
      prompt: {
        type: "string",
        description: "Prompt or objective for the background task.",
      },
      description: {
        type: "string",
        description: "Optional short description of the task scope.",
      },
    },
  },
  async execute(input, context) {
    const task = createRegisteredPromptTask(context.workspaceRoot, {
      prompt: input.prompt,
      description: input.description ?? null,
      sessionId: context.sessionId ?? null,
    });

    return {
      task_id: task.taskId,
      status: task.status,
      prompt: task.prompt,
      description: task.description,
      task_packet: task.taskPacket,
      created_at: task.createdAt,
    };
  },
};
