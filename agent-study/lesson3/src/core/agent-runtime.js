function isRepeatedToolBatch(batch) {
  if (batch.length !== 3) {
    return false;
  }

  const [first, second, third] = batch.map((item) => JSON.stringify(item));
  return first === second && second === third;
}

export class AgentRuntime {
  constructor({ session, model, toolRegistry, systemPrompt, maxIterations = 8, traceLogger = null }) {
    this.session = session;
    this.model = model;
    this.toolRegistry = toolRegistry;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
    this.traceLogger = traceLogger;
  }

  writeSummary(title, payload) {
    this.traceLogger?.writeSummary(title, payload);
  }

  async run(userInput, context) {
    this.session.addUserMessage(userInput);
    const toolBatchHistory = [];
    this.writeSummary("RUN START", {
      userInput,
      workspaceRoot: context.workspaceRoot,
    });

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      const decision = await this.model.decide({
        systemPrompt: this.systemPrompt,
        messages: this.session.snapshot(),
        tools: this.toolRegistry.listTools(),
        iteration,
      });

      if (decision.type === "final") {
        this.writeSummary(`ITERATION ${iteration} FINAL`, {
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
          outputPreview: decision.output.slice(0, 500),
        });
        this.session.addAssistantMessage({
          type: "final_answer",
          output: decision.output,
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
        });
        return {
          output: decision.output,
          session: this.session.snapshot(),
          iterations: iteration,
        };
      }

      if (decision.type !== "tools") {
        throw new Error(`Unsupported model decision type: ${decision.type}`);
      }

      const currentBatch = decision.toolCalls.map((toolCall) => ({
        toolName: toolCall.toolName,
        input: toolCall.input,
        toolCallId: toolCall.toolCallId ?? null,
      }));
      toolBatchHistory.push(currentBatch);
      const lastThreeBatches = toolBatchHistory.slice(-3);
      const repeatedToolBatchWarning = isRepeatedToolBatch(lastThreeBatches)
        ? "repeated_tool_batch_detected"
        : null;
      this.writeSummary(`ITERATION ${iteration} TOOL BATCH`, {
        finishReason: decision.finishReason ?? null,
        warnings: repeatedToolBatchWarning
          ? [...(decision.warnings ?? []), repeatedToolBatchWarning]
          : (decision.warnings ?? []),
        toolCallCount: decision.toolCalls.length,
        toolCalls: currentBatch,
        repeatedToolBatch: repeatedToolBatchWarning !== null,
      });

      const toolResults = [];
      for (const toolCall of decision.toolCalls) {
        this.session.addAssistantMessage({
          type: "tool_request",
          toolName: toolCall.toolName,
          input: toolCall.input,
          toolCallId: toolCall.toolCallId ?? null,
          finishReason: decision.finishReason ?? null,
          warnings: repeatedToolBatchWarning
            ? [...(decision.warnings ?? []), repeatedToolBatchWarning]
            : (decision.warnings ?? []),
        });

        try {
          const toolResult = await this.toolRegistry.execute(toolCall.toolName, toolCall.input, context);
          this.session.addToolMessage(toolCall.toolName, {
            ok: true,
            input: toolCall.input,
            toolCallId: toolCall.toolCallId ?? null,
            content: toolResult,
          });
          toolResults.push({
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: true,
          });
        } catch (error) {
          this.session.addToolMessage(toolCall.toolName, {
            ok: false,
            input: toolCall.input,
            toolCallId: toolCall.toolCallId ?? null,
            error: error instanceof Error ? error.message : String(error),
          });
          toolResults.push({
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: false,
            error: error instanceof Error ? error.message : String(error),
          });
        }
      }
      this.writeSummary(`ITERATION ${iteration} TOOL RESULTS`, toolResults);
    }

    this.writeSummary("RUN FAILED", {
      reason: "max_iterations_exceeded",
      maxIterations: this.maxIterations,
    });
    throw new Error("Agent exceeded max iterations without producing a final answer.");
  }
}
