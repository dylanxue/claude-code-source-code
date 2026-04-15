export class AgentRuntime {
  constructor({ session, model, toolRegistry, systemPrompt, maxIterations = 8 }) {
    this.session = session;
    this.model = model;
    this.toolRegistry = toolRegistry;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
  }

  async run(userInput, context) {
    this.session.addUserMessage(userInput);

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const decision = await this.model.decide({
        systemPrompt: this.systemPrompt,
        messages: this.session.snapshot(),
        tools: this.toolRegistry.listTools(),
        iteration,
      });

      if (decision.type === "final") {
        this.session.addAssistantMessage(decision.output);
        return {
          output: decision.output,
          session: this.session.snapshot(),
          iterations: iteration,
        };
      }

      if (decision.type !== "tool") {
        throw new Error(`Unsupported model decision type: ${decision.type}`);
      }

      const toolResult = await this.toolRegistry.execute(decision.toolName, decision.input, context);
      this.session.addAssistantMessage({
        type: "tool_request",
        toolName: decision.toolName,
        input: decision.input,
      });
      this.session.addToolMessage(decision.toolName, toolResult);
    }

    throw new Error("Agent exceeded max iterations without producing a final answer.");
  }
}
