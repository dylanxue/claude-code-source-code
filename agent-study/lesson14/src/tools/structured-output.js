export const structuredOutputTool = {
  name: "StructuredOutput",
  family: "planning",
  description: "Return structured output in the requested format.",
  inputSchema: {
    type: "object",
    properties: {},
  },
  async execute(input) {
    if (!input || typeof input !== "object" || Array.isArray(input) || Object.keys(input).length === 0) {
      throw new Error("structured output payload must not be empty");
    }

    return {
      data: "Structured output provided successfully",
      structured_output: input,
    };
  },
};

