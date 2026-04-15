import { listRegisteredTasksForSession } from "../core/task-registry.js";

function formatTask(task) {
  return {
    task_id: task.taskId,
    status: task.status,
    prompt: task.prompt,
    description: task.description,
    task_packet: task.taskPacket,
    created_at: task.createdAt,
    updated_at: task.updatedAt,
    agent_id: task.agentId,
    subagent_type: task.subagentType,
  };
}

export const taskListTool = {
  name: "TaskList",
  family: "task",
  description: "List all background tasks and their current status.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  async execute(_input, context) {
    const tasks = listRegisteredTasksForSession(context.workspaceRoot, context.sessionId).map(formatTask);
    return {
      tasks,
      count: tasks.length,
    };
  },
};
