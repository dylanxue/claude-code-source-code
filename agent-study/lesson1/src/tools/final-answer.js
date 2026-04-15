export const finalAnswerTool = {
  name: "final_answer",
  description: "Reserve a final response for the user.",
  async execute(input) {
    return {
      ok: true,
      output: input,
    };
  },
};
