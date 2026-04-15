import { createRegisteredTaskFromPacket } from "../core/task-registry.js";

export const runTaskPacketTool = {
  name: "RunTaskPacket",
  family: "task",
  description: "Create a background task from a structured task packet.",
  inputSchema: {
    type: "object",
    required: [
      "objective",
      "scope",
      "repo",
      "branch_policy",
      "acceptance_tests",
      "commit_policy",
      "reporting_contract",
      "escalation_policy",
    ],
    properties: {
      objective: { type: "string" },
      scope: { type: "string" },
      repo: { type: "string" },
      branch_policy: { type: "string" },
      acceptance_tests: {
        type: "array",
        items: { type: "string" },
      },
      commit_policy: { type: "string" },
      reporting_contract: { type: "string" },
      escalation_policy: { type: "string" },
    },
  },
  async execute(input, context) {
    const task = createRegisteredTaskFromPacket(context.workspaceRoot, input, {
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
