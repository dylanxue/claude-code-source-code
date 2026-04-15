export const finalAnswerTool = {
  name: "final_answer",
  description: "Reserve a final response for the user.",
  inputSchema: {
    type: "object",
    required: ["message"],
    properties: {
      message: { type: "string" },
    },
  },
  async execute(input) {
    return {
      ok: true,
      output: input.message,
    };
  },
};
