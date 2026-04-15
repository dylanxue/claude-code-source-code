import { getRegisteredTask } from "../core/task-registry.js";

export const taskOutputTool = {
  name: "TaskOutput",
  family: "task",
  description: "Retrieve the output produced by a background task.",
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
    const task = getRegisteredTask(context.workspaceRoot, input.task_id, {
      sessionId: context.sessionId,
    });
    if (!task) {
      throw new Error(`task not found: ${input.task_id}`);
    }

    return {
      task_id: task.taskId,
      output: task.output,
      has_output: Boolean(task.output),
    };
  },
};
