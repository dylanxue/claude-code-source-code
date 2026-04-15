import { getRegisteredTask } from "../core/task-registry.js";

function formatTask(task) {
  return {
    task_id: task.taskId,
    status: task.status,
    prompt: task.prompt,
    description: task.description,
    task_packet: task.taskPacket,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    messages: task.messages,
    output: task.output,
    agent_id: task.agentId,
    subagent_type: task.subagentType,
    manifest_file: task.manifestFile,
    output_file: task.outputFile,
    session_file: task.sessionFile,
    error: task.error,
  };
}

export const taskGetTool = {
  name: "TaskGet",
  family: "task",
  description: "Get the status and details of a background task by ID.",
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

    return formatTask(task);
  },
};
