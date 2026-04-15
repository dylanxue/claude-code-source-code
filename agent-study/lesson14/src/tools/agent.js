import { normalizeSubagentType } from "../core/subagent-types.js";

export function createAgentTool({ runSubagent }) {
  if (typeof runSubagent !== "function") {
    throw new Error("createAgentTool requires a runSubagent(input, context) function.");
  }

  const subagentTypeDescription = [
    "Optional subagent role.",
    "Use `Explore` to investigate files and gather facts.",
    "Use `Plan` to break a larger task into steps, risks, and next actions.",
    "Use `general-purpose` for a bounded implementation task.",
    "Use `Verification` for checks, tests, and validation.",
  ].join(" ");

  return {
    name: "Agent",
    family: "delegation",
    description: "Launch a specialized agent task and persist its handoff metadata.",
    searchKeywords: [
      "delegate",
      "delegated",
      "subagent",
      "explore",
      "plan",
      "verification",
      "general-purpose",
      "parallel",
      "investigation",
      "bounded task",
    ],
    inputSchema: {
      type: "object",
      required: ["description", "prompt"],
      properties: {
        description: {
          type: "string",
          description: "Short summary of the delegated task for logs and handoff metadata.",
        },
        prompt: {
          type: "string",
          description: "Concrete instructions for the subagent to execute.",
        },
        subagent_type: {
          type: "string",
          description: subagentTypeDescription,
        },
        name: {
          type: "string",
          description: "Optional stable name for the delegated task.",
        },
        model: {
          type: "string",
          description: "Optional model override for the delegated task.",
        },
      },
    },
    describeCall(input) {
      const normalizedType = normalizeSubagentType(input.subagent_type);
      return {
        summary: [
          `Delegate "${String(input.description ?? "").trim()}"`,
          `using ${normalizedType}`,
          normalizedType === "Explore"
            ? "for investigation"
            : normalizedType === "Plan"
              ? "for planning"
              : normalizedType === "Verification"
                ? "for validation"
                : "for bounded execution",
        ].join(" "),
      };
    },
    async execute(input, context) {
      const description = String(input.description ?? "").trim();
      const prompt = String(input.prompt ?? "").trim();

      if (!description) {
        throw new Error("description must not be empty");
      }

      if (!prompt) {
        throw new Error("prompt must not be empty");
      }

      return runSubagent(
        {
          description,
          prompt,
          subagent_type: normalizeSubagentType(input.subagent_type),
          name: typeof input.name === "string" ? input.name : null,
          model: typeof input.model === "string" ? input.model : null,
        },
        context,
      );
    },
  };
}
