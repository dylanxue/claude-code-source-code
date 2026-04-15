import {
  compactSessionWithStrategy,
  defaultCompactionConfig,
  estimateSessionTokens,
  shouldCompact,
} from "./session-compaction.js";
import {
  buildPreToolUseBlockResult,
  runPreToolUseHooks,
} from "./pre-tool-use-hooks.js";
import {
  planStateFromSubagentResult,
  renderPlanPinMessage,
} from "./plan-state.js";
import {
  normalizeTaskPacket,
} from "./task-packet.js";

function isRepeatedToolBatch(batch) {
  if (batch.length !== 3) {
    return false;
  }

  const [first, second, third] = batch.map((item) => JSON.stringify(item));
  return first === second && second === third;
}

function isSameInput(left, right) {
  return JSON.stringify(left ?? null) === JSON.stringify(right ?? null);
}

function dedupeGuardrails(guardrails) {
  const seen = new Set();
  return guardrails.filter((guardrail) => {
    const key = JSON.stringify([
      guardrail.kind ?? null,
      guardrail.path ?? null,
      guardrail.sourceToolName ?? null,
      guardrail.sourceIteration ?? null,
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
}

function cloneForJournal(value) {
  return value === undefined ? null : JSON.parse(JSON.stringify(value));
}

function summarizeToolResults(toolResults) {
  const summary = {
    okCount: 0,
    errorCount: 0,
    blockedCount: 0,
  };

  for (const result of toolResults) {
    if (result?.blocked) {
      summary.blockedCount += 1;
      continue;
    }
    if (result?.ok) {
      summary.okCount += 1;
      continue;
    }
    summary.errorCount += 1;
  }

  return summary;
}

function buildForcedFinalizationPrompt() {
  return [
    "You have reached the tool-use limit for this run.",
    "Do not call any more tools.",
    "Based only on the evidence already gathered, provide the best concise final answer now.",
    "If your coverage is partial, say what you verified and what remains uncertain.",
  ].join("\n");
}

export class AgentRuntime {
  constructor({
    session,
    model,
    toolRegistry,
    systemPrompt,
    workspaceRoot = null,
    maxIterations = 32,
    traceLogger = null,
    compactionConfig = defaultCompactionConfig(),
    preToolUseHooks = null,
    onSessionUpdated = null,
    onRuntimeEvent = null,
  }) {
    this.session = session;
    this.model = model;
    this.toolRegistry = toolRegistry;
    this.systemPrompt = systemPrompt;
    this.workspaceRoot = workspaceRoot;
    this.maxIterations = maxIterations;
    this.traceLogger = traceLogger;
    this.compactionConfig = compactionConfig;
    this.preToolUseHooks = preToolUseHooks;
    this.onSessionUpdated = onSessionUpdated;
    this.onRuntimeEvent = onRuntimeEvent;
    this.usage = {
      inputTokens: Number(session.usage?.inputTokens ?? 0),
      outputTokens: Number(session.usage?.outputTokens ?? 0),
      cacheCreationInputTokens: Number(session.usage?.cacheCreationInputTokens ?? 0),
      cacheReadInputTokens: Number(session.usage?.cacheReadInputTokens ?? 0),
    };
    this.currentUsage = {
      inputTokens: Number(session.usage?.currentUsage?.inputTokens ?? 0),
      outputTokens: Number(session.usage?.currentUsage?.outputTokens ?? 0),
      cacheCreationInputTokens: Number(session.usage?.currentUsage?.cacheCreationInputTokens ?? 0),
      cacheReadInputTokens: Number(session.usage?.currentUsage?.cacheReadInputTokens ?? 0),
    };
    this.latestRequestBudget = null;
    this.pendingGuardrails = [];
    this.decisionJournal = [];
  }

  writeSummary(title, payload) {
    this.traceLogger?.writeSummary(title, payload);
  }

  buildSystemPrompt(context = {}) {
    return [
      this.systemPrompt,
      renderPlanPinMessage(this.session.planState),
      context.analysisHint,
    ]
      .filter(Boolean)
      .join("\n\n");
  }

  persistSession() {
    this.onSessionUpdated?.(this.session);
  }

  emitRuntimeEvent(event) {
    this.onRuntimeEvent?.(event);
  }

  resetDecisionJournal() {
    this.decisionJournal = [];
  }

  recordDecisionJournal(entry) {
    const normalizedEntry = cloneForJournal(entry);
    this.decisionJournal.push(normalizedEntry);
    this.emitRuntimeEvent({
      channel: "runtime_decision",
      ...normalizedEntry,
    });
  }

  getToolMetadata(toolName) {
    return this.toolRegistry.getToolMetadata(toolName) ?? {
      name: toolName,
      family: null,
    };
  }

  buildToolCallDescriptor(toolCall) {
    return this.toolRegistry.describeToolCall(toolCall.toolName, toolCall.input, {
      toolCallId: toolCall.toolCallId ?? null,
    });
  }

  extractEnforcements(preparedToolResult) {
    const enforcements = [];
    const contentEnforcement = preparedToolResult?.content?.enforcement ?? null;

    if (contentEnforcement && typeof contentEnforcement === "object") {
      enforcements.push(contentEnforcement);
    }

    return enforcements;
  }

  findBlockedToolCall(toolCall) {
    const descriptor = this.buildToolCallDescriptor(toolCall);
    const hooks = this.preToolUseHooks ?? this.toolRegistry.getPreToolUseHooks(toolCall.toolName);
    return runPreToolUseHooks({
      toolCall,
      descriptor,
      activeGuardrails: this.pendingGuardrails,
      hooks,
      workspaceRoot: this.workspaceRoot,
    });
  }

  extractGuardrails(toolName, toolInput, preparedToolResult, iteration) {
    const sourceToolMetadata = this.getToolMetadata(toolName);
    return this.extractEnforcements(preparedToolResult).map((guardrail) => ({
      ...guardrail,
      sourceIteration: iteration,
      sourceToolName: toolName,
      sourceToolFamily: sourceToolMetadata.family,
      sourceInput: toolInput,
    }));
  }

  hasUsageField(usage, key) {
    return Boolean(usage) && Object.prototype.hasOwnProperty.call(usage, key);
  }

  hasRealInputUsage(usage) {
    if (!usage || typeof usage !== "object") {
      return false;
    }

    return (
      this.hasUsageField(usage, "input_tokens") ||
      this.hasUsageField(usage, "inputTokens") ||
      this.hasUsageField(usage, "prompt_tokens")
    );
  }

  requestBudget(decision = null) {
    const preflight = decision?.preflight ?? null;
    const pressureRatio =
      preflight?.contextWindowTokens && preflight?.estimatedTotalTokens
        ? preflight.estimatedTotalTokens / preflight.contextWindowTokens
        : null;
    return {
      available: Boolean(preflight),
      source: preflight ? "request_preflight_estimate" : "unavailable",
      estimatedInputTokens: preflight?.estimatedInputTokens ?? null,
      estimatedTotalTokens: preflight?.estimatedTotalTokens ?? null,
      contextWindowTokens: preflight?.contextWindowTokens ?? null,
      pressureRatio,
      exceeded: preflight?.exceeded ?? null,
    };
  }

  hasProviderUsage() {
    return this.usage.inputTokens > 0;
  }

  usageAvailability(decision = null) {
    const decisionUsage = decision?.usage ?? null;
    return {
      currentTurnHasInputTokens: this.hasRealInputUsage(decisionUsage),
      cumulativeInputTokensObserved: this.hasProviderUsage(),
      providerUsageMode: this.hasProviderUsage() ? "provider_usage" : "unavailable",
      requestBudgetMode: decision?.preflight ? "request_preflight_estimate" : "unavailable",
      compactionMode: this.hasProviderUsage() ? "provider_usage" : "session_fallback_estimate",
    };
  }

  recordUsage(usage) {
    if (!usage || typeof usage !== "object") {
      return;
    }

    this.currentUsage = {
      inputTokens: Number(usage.input_tokens ?? usage.inputTokens ?? usage.prompt_tokens ?? 0),
      outputTokens: Number(usage.output_tokens ?? usage.outputTokens ?? usage.completion_tokens ?? 0),
      cacheCreationInputTokens: Number(
        usage.cache_creation_input_tokens ?? usage.cacheCreationInputTokens ?? 0,
      ),
      cacheReadInputTokens: Number(
        usage.cache_read_input_tokens ?? usage.cacheReadInputTokens ?? 0,
      ),
    };

    this.usage.inputTokens += this.currentUsage.inputTokens;
    this.usage.outputTokens += this.currentUsage.outputTokens;
    this.usage.cacheCreationInputTokens += this.currentUsage.cacheCreationInputTokens;
    this.usage.cacheReadInputTokens += this.currentUsage.cacheReadInputTokens;
    this.session.recordUsage({
      ...this.usage,
      currentUsage: this.currentUsage,
    });
    this.persistSession();
  }

  async previewRequestBudget({ prompt, analysisHint = "", taskPacket = null }) {
    if (typeof this.model.previewBudget !== "function") {
      return null;
    }

    const previewMessages = [
      ...this.session.snapshot(),
      {
        role: "user",
        content: prompt,
        createdAt: new Date().toISOString(),
      },
    ];

    return this.model.previewBudget({
      systemPrompt: [
        this.systemPrompt,
        renderPlanPinMessage(this.session.planState),
        analysisHint,
      ]
        .filter(Boolean)
        .join("\n\n"),
      messages: previewMessages,
      tools: this.toolRegistry.listTools(),
    });
  }

  shouldAutoCompact() {
    const latestBudget = this.latestRequestBudget;
    const requestBudgetRatioThreshold = this.compactionConfig.autoCompactRequestBudgetRatio;
    const inputThreshold = this.compactionConfig.autoCompactInputTokensThreshold;
    if (Number.isFinite(inputThreshold) && inputThreshold > 0 && this.usage.inputTokens >= inputThreshold) {
      const lastCompactionInputTokens = Number(this.session.compaction?.lastCompactionInputTokens ?? 0);
      const minDelta = Number(
        this.compactionConfig.autoCompactMinInputTokensDelta ?? inputThreshold,
      );
      const inputTokensSinceLastCompaction = this.usage.inputTokens - lastCompactionInputTokens;
      if (
        lastCompactionInputTokens > 0 &&
        Number.isFinite(minDelta) &&
        minDelta > 0 &&
        inputTokensSinceLastCompaction < minDelta
      ) {
        return null;
      }

      return {
        reason: "cumulative_input_tokens",
        mode: "provider_usage",
        threshold: inputThreshold,
        cumulativeInputTokens: this.usage.inputTokens,
        cumulativeOutputTokens: this.usage.outputTokens,
        lastCompactionInputTokens,
        inputTokensSinceLastCompaction,
        minInputTokensDelta: minDelta,
      };
    }

    if (
      latestBudget?.available &&
      Number.isFinite(latestBudget.pressureRatio) &&
      Number.isFinite(requestBudgetRatioThreshold) &&
      latestBudget.pressureRatio >= requestBudgetRatioThreshold &&
      shouldCompact(this.session, this.compactionConfig)
    ) {
      return {
        reason: "request_budget_pressure",
        mode: "request_preflight_estimate",
        threshold: requestBudgetRatioThreshold,
        pressureRatio: latestBudget.pressureRatio,
        estimatedTotalTokens: latestBudget.estimatedTotalTokens,
        contextWindowTokens: latestBudget.contextWindowTokens,
      };
    }

    if (this.hasProviderUsage()) {
      return null;
    }

    if (shouldCompact(this.session, this.compactionConfig)) {
      return {
        reason: "estimated_session_tokens",
        mode: "session_fallback_estimate",
        threshold: this.compactionConfig.maxEstimatedTokens,
        estimatedSessionTokens: estimateSessionTokens(this.session),
      };
    }

    return null;
  }

  async maybeAutoCompact(iteration) {
    const compactTrigger = this.shouldAutoCompact();
    if (!compactTrigger) {
      return null;
    }

    const beforeTokens = estimateSessionTokens(this.session);
    const result = await compactSessionWithStrategy(this.session, this.compactionConfig, {
      model: this.model,
      systemPrompt: this.systemPrompt,
      iteration,
      force: compactTrigger.mode === "provider_usage",
      lastCompactionInputTokens: this.usage.inputTokens,
    });
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
      autoCompactInputTokensThreshold: this.compactionConfig.autoCompactInputTokensThreshold,
      autoCompactMinInputTokensDelta: this.compactionConfig.autoCompactMinInputTokensDelta,
      autoCompactRequestBudgetRatio: this.compactionConfig.autoCompactRequestBudgetRatio,
      usage: this.usage,
      usageAvailability: this.usageAvailability(),
      requestBudget: this.latestRequestBudget ?? this.requestBudget(),
      trigger: compactTrigger,
      summaryMode: result.summaryMode,
      summaryError: result.summaryError,
    });

    return result;
  }

  async maybeForcedCompactForContextLimit(iteration) {
    const summaryPrefixLength = this.session.messages[0]?.role === "system" ? 1 : 0;
    const compactableMessages = this.session.messages.slice(summaryPrefixLength);
    if (compactableMessages.length <= this.compactionConfig.preserveRecentMessages) {
      return null;
    }

    const beforeTokens = estimateSessionTokens(this.session);
    const result = await compactSessionWithStrategy(this.session, this.compactionConfig, {
      model: this.model,
      systemPrompt: this.systemPrompt,
      iteration,
      force: true,
      lastCompactionInputTokens: this.usage.inputTokens,
    });
    if (result.removedMessageCount === 0) {
      return null;
    }

    const afterTokens = estimateSessionTokens(result.compactedSession);
    this.session.replaceWith(result.compactedSession);
    this.persistSession();
    this.writeSummary(`ITERATION ${iteration} FORCED COMPACTION`, {
      reason: "provider_context_limit_exceeded",
      removedMessageCount: result.removedMessageCount,
      summaryPreview: result.formattedSummary.slice(0, 800),
      beforeEstimatedTokens: beforeTokens,
      afterEstimatedTokens: afterTokens,
      compactionCount: this.session.compaction?.count ?? 0,
      preserveRecentMessages: this.compactionConfig.preserveRecentMessages,
      maxEstimatedTokens: this.compactionConfig.maxEstimatedTokens,
      autoCompactInputTokensThreshold: this.compactionConfig.autoCompactInputTokensThreshold,
      autoCompactMinInputTokensDelta: this.compactionConfig.autoCompactMinInputTokensDelta,
      autoCompactRequestBudgetRatio: this.compactionConfig.autoCompactRequestBudgetRatio,
      usage: this.usage,
      usageAvailability: this.usageAvailability(),
      requestBudget: this.latestRequestBudget ?? this.requestBudget(),
      summaryMode: result.summaryMode,
      summaryError: result.summaryError,
    });
    return result;
  }

  async attemptForcedFinalization(iteration, context) {
    const forcedIteration = iteration + 1;
    const forcedPrompt = buildForcedFinalizationPrompt();
    const forcedMessages = [
      ...this.session.snapshot(),
      {
        role: "user",
        content: forcedPrompt,
        createdAt: new Date().toISOString(),
      },
    ];

    this.writeSummary("FORCED FINALIZATION ATTEMPT", {
      reason: "max_iterations_reached",
      iteration: forcedIteration,
      prompt: forcedPrompt,
    });

    let decision;
    try {
      decision = await this.model.decide({
        systemPrompt: this.buildSystemPrompt(context),
        messages: forcedMessages,
        tools: [],
        iteration: forcedIteration,
        onAssistantEvent: (event) => {
          this.emitRuntimeEvent({
            channel: "assistant_stream",
            iteration: forcedIteration,
            forcedFinalization: true,
            ...event,
          });
        },
      });
    } catch (error) {
      this.writeSummary("FORCED FINALIZATION FAILED", {
        iteration: forcedIteration,
        error: error instanceof Error ? error.message : String(error),
      });
      return null;
    }

    this.latestRequestBudget = this.requestBudget(decision);
    this.recordUsage(decision.usage);

    if (decision.type !== "final") {
      this.recordDecisionJournal({
        kind: "model_decision",
        iteration: forcedIteration,
        decisionType: decision.type,
        finishReason: decision.finishReason ?? null,
        warnings: decision.warnings ?? [],
        requestBudget: this.requestBudget(decision),
        usageAvailability: this.usageAvailability(decision),
        activeGuardrailCount: this.pendingGuardrails.length,
        forcedFinalization: true,
      });
      this.writeSummary("FORCED FINALIZATION NON_FINAL", {
        iteration: forcedIteration,
        decisionType: decision.type,
        finishReason: decision.finishReason ?? null,
        warnings: decision.warnings ?? [],
      });
      return null;
    }

    this.recordDecisionJournal({
      kind: "model_decision",
      iteration: forcedIteration,
      decisionType: "final",
      finishReason: decision.finishReason ?? null,
      warnings: decision.warnings ?? [],
      requestBudget: this.requestBudget(decision),
      usageAvailability: this.usageAvailability(decision),
      activeGuardrailCount: this.pendingGuardrails.length,
      forcedFinalization: true,
    });
    this.writeSummary(`ITERATION ${forcedIteration} FORCED FINAL`, {
      finishReason: decision.finishReason ?? null,
      warnings: decision.warnings ?? [],
      reasoningPreview: (decision.reasoning ?? "").slice(0, 500),
      outputPreview: decision.output.slice(0, 500),
      usage: decision.usage ?? null,
      usageAvailability: this.usageAvailability(decision),
      requestBudget: this.requestBudget(decision),
      cumulativeUsage: this.usage,
      forcedFinalization: true,
      activeGuardrails: this.pendingGuardrails,
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
      iteration: forcedIteration,
      finishReason: decision.finishReason ?? null,
      output: decision.output,
      forcedFinalization: true,
    });
    return {
      output: decision.output,
      session: this.session.snapshot(),
      iterations: forcedIteration,
      decisionJournal: cloneForJournal(this.decisionJournal),
    };
  }

  async run(userInput, context) {
    this.workspaceRoot = context.workspaceRoot ?? this.workspaceRoot;
    const taskPacket = normalizeTaskPacket(context.taskPacket) ?? this.session.taskPacket;
    if (taskPacket) {
      this.session.setTaskPacket(taskPacket);
      this.persistSession();
    }
    this.resetDecisionJournal();
    this.session.addUserMessage(userInput);
    this.persistSession();
    const toolBatchHistory = [];
    this.writeSummary("RUN START", {
      userInput,
      workspaceRoot: context.workspaceRoot,
      isResumed: context.isResumed ?? false,
      resumePath: context.resumePath ?? null,
      existingMessageCount: context.existingMessageCount ?? null,
      existingCompactionCount: context.existingCompactionCount ?? null,
      toolResultBudget: this.toolResultBudgetConfig,
    });

    for (let iteration = 1; iteration <= this.maxIterations; iteration += 1) {
      await this.maybeAutoCompact(iteration);

      let decision;
      try {
        decision = await this.model.decide({
          systemPrompt: this.buildSystemPrompt({
            ...context,
            taskPacket,
          }),
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
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        if (message.startsWith("Estimated request exceeds model context window")) {
          const forcedCompaction = await this.maybeForcedCompactForContextLimit(iteration);
          if (forcedCompaction) {
            iteration -= 1;
            continue;
          }
        }
        throw error;
      }

      this.latestRequestBudget = this.requestBudget(decision);
      this.recordUsage(decision.usage);

      if (decision.type === "final") {
        this.recordDecisionJournal({
          kind: "model_decision",
          iteration,
          decisionType: "final",
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
          requestBudget: this.requestBudget(decision),
          usageAvailability: this.usageAvailability(decision),
          activeGuardrailCount: this.pendingGuardrails.length,
        });
        this.writeSummary(`ITERATION ${iteration} FINAL`, {
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
          reasoningPreview: (decision.reasoning ?? "").slice(0, 500),
          outputPreview: decision.output.slice(0, 500),
          usage: decision.usage ?? null,
          usageAvailability: this.usageAvailability(decision),
          requestBudget: this.requestBudget(decision),
          cumulativeUsage: this.usage,
          activeGuardrails: this.pendingGuardrails,
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
          decisionJournal: cloneForJournal(this.decisionJournal),
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
      const preToolUseBlockCandidates = decision.toolCalls
        .map((toolCall) => ({
          toolCall,
          blocked: this.findBlockedToolCall(toolCall),
        }))
        .filter((entry) => Boolean(entry.blocked));
      const preToolUseBlockWarning = preToolUseBlockCandidates.length > 0
        ? "pre_tool_use_block_detected"
        : null;
      const toolBatchWarnings = [
        ...(decision.warnings ?? []),
        ...(repeatedToolBatchWarning ? [repeatedToolBatchWarning] : []),
        ...(preToolUseBlockWarning ? [preToolUseBlockWarning] : []),
      ];
      this.recordDecisionJournal({
        kind: "model_decision",
        iteration,
        decisionType: "tools",
        finishReason: decision.finishReason ?? null,
        warnings: toolBatchWarnings,
        requestBudget: this.requestBudget(decision),
        usageAvailability: this.usageAvailability(decision),
        activeGuardrailCount: this.pendingGuardrails.length,
        toolCallCount: decision.toolCalls.length,
        repeatedToolBatchDetected: repeatedToolBatchWarning !== null,
        preToolUseBlockDetected: preToolUseBlockWarning !== null,
        toolCalls: currentBatch,
      });
      this.writeSummary(`ITERATION ${iteration} TOOL BATCH`, {
        finishReason: decision.finishReason ?? null,
        warnings: toolBatchWarnings,
        reasoningPreview: (decision.reasoning ?? "").slice(0, 500),
        outputPreview: (decision.output ?? "").slice(0, 500),
        usage: decision.usage ?? null,
        usageAvailability: this.usageAvailability(decision),
        requestBudget: this.requestBudget(decision),
        cumulativeUsage: this.usage,
        toolCallCount: decision.toolCalls.length,
        toolCalls: currentBatch,
        repeatedToolBatch: repeatedToolBatchWarning !== null,
        activeGuardrails: this.pendingGuardrails,
        preToolUseBlockCandidates: preToolUseBlockCandidates.map(({ toolCall, blocked }) => ({
          toolName: toolCall.toolName,
          toolCallId: toolCall.toolCallId ?? null,
          input: toolCall.input,
          blockedBy: blocked?.guardrail?.kind ?? "pre_tool_use_blocked",
          sourceToolName: blocked?.guardrail?.sourceToolName ?? null,
        })),
      });

      if (decision.output?.trim()) {
        this.session.addAssistantMessage(decision.output);
        this.persistSession();
      }

      const toolResults = [];
      const nextGuardrails = [];
      for (const toolCall of decision.toolCalls) {
        this.session.addAssistantMessage({
          type: "tool_request",
          toolName: toolCall.toolName,
          input: toolCall.input,
          toolCallId: toolCall.toolCallId ?? null,
          finishReason: decision.finishReason ?? null,
          warnings: toolBatchWarnings,
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

        const blockedToolCall = this.findBlockedToolCall(toolCall);
        if (blockedToolCall) {
          const blockedResult = buildPreToolUseBlockResult(
            toolCall,
            blockedToolCall,
          );
          this.session.addToolMessage(toolCall.toolName, {
            ok: false,
            blocked: true,
            input: toolCall.input,
            toolCallId: toolCall.toolCallId ?? null,
            content: blockedResult,
            error: `Blocked by pre-tool-use hook: ${blockedToolCall.guardrail.kind ?? "pre_tool_use_blocked"}`,
          });
          this.persistSession();
          this.emitRuntimeEvent({
            channel: "pre_tool_use_block",
            iteration,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            blockedBy: blockedToolCall.guardrail.kind ?? "pre_tool_use_blocked",
            sourceToolName: blockedToolCall.guardrail.sourceToolName,
          });
          this.emitRuntimeEvent({
            channel: "tool_execution",
            phase: "finish",
            iteration,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: false,
            blocked: true,
            error: `Blocked by pre-tool-use hook: ${blockedToolCall.guardrail?.kind ?? "pre_tool_use_blocked"}`,
          });
          toolResults.push({
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: false,
            blocked: true,
            blockedBy: blockedToolCall.guardrail?.kind ?? "pre_tool_use_blocked",
            sourceToolName: blockedToolCall.guardrail?.sourceToolName,
            content: blockedResult,
            error: `Blocked by pre-tool-use hook: ${blockedToolCall.guardrail?.kind ?? "pre_tool_use_blocked"}`,
          });
          continue;
        }

        try {
          const toolResult = await this.toolRegistry.execute(toolCall.toolName, toolCall.input, context);
          this.session.addToolMessage(toolCall.toolName, {
            ok: true,
            input: toolCall.input,
            toolCallId: toolCall.toolCallId ?? null,
            content: toolResult,
          });
          if (toolCall.toolName === "Agent") {
            const nextPlanState = planStateFromSubagentResult(toolResult, this.session.taskPacket);
            if (nextPlanState) {
              this.session.setPlanState(nextPlanState);
            }
          }
          this.persistSession();
          this.emitRuntimeEvent({
            channel: "tool_execution",
            phase: "finish",
            iteration,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: true,
          });
          nextGuardrails.push(
            ...this.extractGuardrails(
              toolCall.toolName,
              toolCall.input,
              { content: toolResult },
              iteration,
            ),
          );
          toolResults.push({
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: true,
            content: toolResult,
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
      this.pendingGuardrails = dedupeGuardrails(nextGuardrails);
      const toolResultSummary = summarizeToolResults(toolResults);
      this.recordDecisionJournal({
        kind: "tool_results",
        iteration,
        ...toolResultSummary,
        newGuardrailCount: this.pendingGuardrails.length,
        toolResults: toolResults.map((result) => ({
          toolName: result.toolName,
          toolCallId: result.toolCallId ?? null,
          ok: Boolean(result.ok),
          blocked: Boolean(result.blocked),
          blockedBy: result.blockedBy ?? null,
          error: result.error ?? null,
        })),
      });
      this.writeSummary(`ITERATION ${iteration} TOOL RESULTS`, toolResults);
    }

    const forcedFinalizationResult = await this.attemptForcedFinalization(this.maxIterations, context);
    if (forcedFinalizationResult) {
      return forcedFinalizationResult;
    }

    this.writeSummary("RUN FAILED", {
      reason: "max_iterations_exceeded",
      maxIterations: this.maxIterations,
    });
    throw new Error("Agent exceeded max iterations without producing a final answer.");
  }
}
