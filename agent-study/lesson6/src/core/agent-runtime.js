import {
  compactSession,
  defaultCompactionConfig,
  estimateSessionTokens,
  shouldCompact,
} from "./session-compaction.js";

function isRepeatedToolBatch(batch) {
  if (batch.length !== 3) {
    return false;
  }

  const [first, second, third] = batch.map((item) => JSON.stringify(item));
  return first === second && second === third;
}

export class AgentRuntime {
  constructor({
    session,
    model,
    toolRegistry,
    systemPrompt,
    maxIterations = 32,
    traceLogger = null,
    compactionConfig = defaultCompactionConfig(),
    onSessionUpdated = null,
    onRuntimeEvent = null,
  }) {
    this.session = session;
    this.model = model;
    this.toolRegistry = toolRegistry;
    this.systemPrompt = systemPrompt;
    this.maxIterations = maxIterations;
    this.traceLogger = traceLogger;
    this.compactionConfig = compactionConfig;
    this.onSessionUpdated = onSessionUpdated;
    this.onRuntimeEvent = onRuntimeEvent;
  }

  writeSummary(title, payload) {
    this.traceLogger?.writeSummary(title, payload);
  }

  persistSession() {
    this.onSessionUpdated?.(this.session);
  }

  emitRuntimeEvent(event) {
    this.onRuntimeEvent?.(event);
  }

  maybeAutoCompact(iteration) {
    if (!shouldCompact(this.session, this.compactionConfig)) {
      return null;
    }

    const beforeTokens = estimateSessionTokens(this.session);
    const result = compactSession(this.session, this.compactionConfig);
    const afterTokens = estimateSessionTokens(result.compactedSession);
    this.session.replaceWith(result.compactedSession);
    this.persistSession();

    this.writeSummary(`ITERATION ${iteration} AUTO COMPACTION`, {
      removedMessageCount: result.removedMessageCount,
      summaryPreview: result.formattedSummary.slice(0, 800),
      beforeEstimatedTokens: beforeTokens,
      afterEstimatedTokens: afterTokens,
      compactionCount: this.session.compaction?.count ?? 0,
      preserveRecentMessages: this.compactionConfig.preserveRecentMessages,
      maxEstimatedTokens: this.compactionConfig.maxEstimatedTokens,
    });

    return result;
  }

  async run(userInput, context) {
    this.session.addUserMessage(userInput);
    this.persistSession();
    const toolBatchHistory = [];
    this.writeSummary("RUN START", {
      userInput,
      workspaceRoot: context.workspaceRoot,
    });

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      this.maybeAutoCompact(iteration);

      const decision = await this.model.decide({
        systemPrompt: this.systemPrompt,
        messages: this.session.snapshot(),
        tools: this.toolRegistry.listTools(),
        iteration,
        onAssistantEvent: (event) => {
          this.emitRuntimeEvent({
            channel: "assistant_stream",
            iteration,
            ...event,
          });
        },
      });

      if (decision.type === "final") {
        this.writeSummary(`ITERATION ${iteration} FINAL`, {
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
          reasoningPreview: (decision.reasoning ?? "").slice(0, 500),
          outputPreview: decision.output.slice(0, 500),
        });
        this.session.addAssistantMessage({
          type: "final_answer",
          output: decision.output,
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
        });
        this.persistSession();
        this.emitRuntimeEvent({
          channel: "assistant_final",
          iteration,
          finishReason: decision.finishReason ?? null,
          output: decision.output,
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
        reasoningPreview: (decision.reasoning ?? "").slice(0, 500),
        outputPreview: (decision.output ?? "").slice(0, 500),
        toolCallCount: decision.toolCalls.length,
        toolCalls: currentBatch,
        repeatedToolBatch: repeatedToolBatchWarning !== null,
      });

      if (decision.output?.trim()) {
        this.session.addAssistantMessage(decision.output);
        this.persistSession();
      }

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
        this.persistSession();
        this.emitRuntimeEvent({
          channel: "tool_execution",
          phase: "start",
          iteration,
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId ?? null,
          input: toolCall.input,
        });

        try {
          const toolResult = await this.toolRegistry.execute(toolCall.toolName, toolCall.input, context);
          this.session.addToolMessage(toolCall.toolName, {
            ok: true,
            input: toolCall.input,
            toolCallId: toolCall.toolCallId ?? null,
            content: toolResult,
          });
          this.persistSession();
          this.emitRuntimeEvent({
            channel: "tool_execution",
            phase: "finish",
            iteration,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: true,
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
          this.persistSession();
          this.emitRuntimeEvent({
            channel: "tool_execution",
            phase: "finish",
            iteration,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: false,
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
