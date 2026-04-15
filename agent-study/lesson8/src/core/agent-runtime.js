import {
  compactSessionWithStrategy,
  defaultCompactionConfig,
  estimateSessionTokens,
  shouldCompact,
} from "./session-compaction.js";
import { applyToolResultBudget, defaultToolResultBudgetConfig } from "./tool-result-budget.js";

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

function normalizePathValue(value) {
  if (typeof value !== "string") {
    return null;
  }

  const normalized = value.trim();
  return normalized.length > 0 ? normalized : null;
}

function isNarrowerPath(sourcePath, candidatePath) {
  const source = normalizePathValue(sourcePath) ?? ".";
  const candidate = normalizePathValue(candidatePath) ?? ".";
  if (candidate === source) {
    return false;
  }
  if (source === ".") {
    return candidate !== ".";
  }
  return candidate.startsWith(`${source.replace(/\/+$/, "")}/`);
}

function isMoreSpecificPattern(sourcePattern, candidatePattern) {
  if (typeof sourcePattern !== "string" || typeof candidatePattern !== "string") {
    return false;
  }
  if (candidatePattern === sourcePattern) {
    return false;
  }
  return candidatePattern.length > sourcePattern.length || candidatePattern.includes(sourcePattern);
}

function classifyBashCommandShape(command) {
  const normalized = String(command ?? "").trim();
  if (
    /^\s*cat\s+/.test(normalized) ||
    /^\s*head\s+-\d+\s+/.test(normalized) ||
    /^\s*head\s+/.test(normalized) ||
    /^\s*tail\s+-\d+\s+/.test(normalized) ||
    /^\s*tail\s+/.test(normalized) ||
    /^\s*sed\s+-n\s+/.test(normalized) ||
    /readFileSync\(/.test(normalized) ||
    /&&\s*head\s+/.test(normalized) ||
    /&&\s*tail\s+/.test(normalized) ||
    /&&\s*sed\s+-n\s+/.test(normalized)
  ) {
    return "direct_file_dump";
  }
  if (/\b(wc\s+-l|grep\s+-n|rg\b|stat\b|ls\s+-l)\b/.test(normalized)) {
    return "metadata_query";
  }
  return "other";
}

function normalizeContinuationHint({ continuation, source, toolName, toolInput, iteration }) {
  if (!continuation || typeof continuation !== "object") {
    return null;
  }

  return {
    source,
    sourceIteration: iteration,
    sourceToolName: toolName,
    sourceInput: toolInput,
    reason: continuation.reason ?? null,
    summary: continuation.summary ?? null,
    strategy: continuation.strategy ?? null,
    suggestedTool: continuation.suggestedTool ?? null,
    suggestedActions: continuation.suggestedActions ?? [],
  };
}

function dedupeContinuationHints(hints) {
  const seen = new Set();
  return hints.filter((hint) => {
    const key = JSON.stringify([
      hint.source,
      hint.sourceToolName,
      hint.reason,
      hint.strategy,
      hint.suggestedTool,
      hint.sourceInput ?? null,
    ]);
    if (seen.has(key)) {
      return false;
    }
    seen.add(key);
    return true;
  });
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
    this.toolResultBudgetConfig = defaultToolResultBudgetConfig();
    this.pendingContinuationHints = [];
    this.continuationSteeringHint = "";
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

  prepareToolResult(toolName, toolResult) {
    return applyToolResultBudget(toolName, toolResult, this.toolResultBudgetConfig);
  }

  extractContinuationHints(toolName, toolInput, preparedToolResult, iteration) {
    const hints = [];
    const contentContinuation = normalizeContinuationHint({
      continuation: preparedToolResult?.content?.continuation ?? null,
      source: "tool_result",
      toolName,
      toolInput,
      iteration,
    });
    if (contentContinuation) {
      hints.push(contentContinuation);
    }

    const budgetContinuation = normalizeContinuationHint({
      continuation: preparedToolResult?.budget?.continuation ?? null,
      source: "tool_result_budget",
      toolName,
      toolInput,
      iteration,
    });
    if (budgetContinuation) {
      hints.push(budgetContinuation);
    }

    return dedupeContinuationHints(hints);
  }

  assessContinuationHint(hint, currentBatch) {
    const matchingCalls = currentBatch.filter((toolCall) => {
      if (hint.suggestedTool && toolCall.toolName === hint.suggestedTool) {
        return true;
      }
      return toolCall.toolName === hint.sourceToolName;
    });

    if (matchingCalls.length === 0) {
      return {
        status: "no_signal",
        detail: "no_matching_tool_calls",
      };
    }

    switch (hint.strategy) {
      case "avoid_direct_file_dump": {
        if (
          matchingCalls.some(
            (toolCall) =>
              toolCall.toolName === "bash" &&
              classifyBashCommandShape(toolCall.input?.command) === "direct_file_dump",
          )
        ) {
          return {
            status: "ignored",
            detail: "retried_direct_file_dump",
          };
        }
        return {
          status: "followed",
          detail: "avoided_direct_file_dump",
        };
      }
      case "avoid_broad_file_read":
      case "narrow_file_region": {
        if (
          currentBatch.some(
            (toolCall) =>
              toolCall.toolName === "bash" &&
              classifyBashCommandShape(toolCall.input?.command) === "direct_file_dump",
          )
        ) {
          return {
            status: "ignored",
            detail: "retried_broad_file_dump",
          };
        }
        if (
          currentBatch.some(
            (toolCall) => toolCall.toolName === "read_file" && isSameInput(toolCall.input, hint.sourceInput),
          )
        ) {
          return {
            status: "ignored",
            detail: "retried_same_file_read",
          };
        }
        if (
          currentBatch.some(
            (toolCall) =>
              toolCall.toolName === "grep_text" ||
              toolCall.toolName === "list_files" ||
              (toolCall.toolName === "bash" &&
                classifyBashCommandShape(toolCall.input?.command) === "metadata_query"),
          )
        ) {
          return {
            status: "followed",
            detail: "used_narrower_file_follow_up",
          };
        }
        return {
          status: "no_signal",
          detail: "no_clear_file_follow_up",
        };
      }
      case "narrow_path": {
        if (
          matchingCalls.some((toolCall) => isNarrowerPath(hint.sourceInput?.path, toolCall.input?.path))
        ) {
          return {
            status: "followed",
            detail: "narrowed_path",
          };
        }
        if (
          matchingCalls.some(
            (toolCall) => normalizePathValue(toolCall.input?.path) === normalizePathValue(hint.sourceInput?.path),
          )
        ) {
          return {
            status: "ignored",
            detail: "reused_same_path",
          };
        }
        return {
          status: "no_signal",
          detail: "path_not_comparable",
        };
      }
      case "narrow_search": {
        const grepCalls = currentBatch.filter((toolCall) => toolCall.toolName === "grep_text");
        if (
          grepCalls.some(
            (toolCall) =>
              isNarrowerPath(hint.sourceInput?.path, toolCall.input?.path) ||
              isMoreSpecificPattern(hint.sourceInput?.pattern, toolCall.input?.pattern),
          )
        ) {
          return {
            status: "followed",
            detail: "narrowed_search_scope",
          };
        }
        if (grepCalls.some((toolCall) => isSameInput(toolCall.input, hint.sourceInput))) {
          return {
            status: "ignored",
            detail: "retried_same_search",
          };
        }
        return {
          status: "no_signal",
          detail: "no_clear_search_follow_up",
        };
      }
      case "narrow_shell_output":
      case "narrow_result_scope": {
        if (matchingCalls.some((toolCall) => isSameInput(toolCall.input, hint.sourceInput))) {
          return {
            status: "ignored",
            detail: "retried_same_broad_request",
          };
        }
        if (matchingCalls.length > 0) {
          return {
            status: "followed",
            detail: "changed_request_shape",
          };
        }
        return {
          status: "no_signal",
          detail: "no_clear_scope_change",
        };
      }
      default: {
        if (matchingCalls.length > 0) {
          return {
            status: "followed",
            detail: "used_suggested_tool",
          };
        }
        return {
          status: "no_signal",
          detail: "no_matching_follow_up",
        };
      }
    }
  }

  assessContinuationBatch(currentBatch) {
    if (!this.pendingContinuationHints.length) {
      return null;
    }

    const hintAssessments = this.pendingContinuationHints.map((hint) => ({
      hint,
      assessment: this.assessContinuationHint(hint, currentBatch),
    }));
    const statuses = hintAssessments.map((entry) => entry.assessment.status);
    const hasFollowed = statuses.includes("followed");
    const hasIgnored = statuses.includes("ignored");
    const followedCount = statuses.filter((status) => status === "followed").length;
    const ignoredCount = statuses.filter((status) => status === "ignored").length;
    const noSignalCount = statuses.filter((status) => status === "no_signal").length;

    const overallStatus = hasFollowed && hasIgnored
      ? "mixed"
      : hasIgnored
        ? "ignored"
        : hasFollowed
          ? "followed"
          : "no_signal";

    return {
      availableHintCount: this.pendingContinuationHints.length,
      overallStatus,
      followedCount,
      ignoredCount,
      noSignalCount,
      hints: hintAssessments.map(({ hint, assessment }) => ({
        source: hint.source,
        sourceIteration: hint.sourceIteration,
        sourceToolName: hint.sourceToolName,
        reason: hint.reason,
        strategy: hint.strategy,
        suggestedTool: hint.suggestedTool,
        assessment: assessment.status,
        detail: assessment.detail,
      })),
    };
  }

  buildContinuationSteeringHint(continuationAssessment) {
    if (!continuationAssessment || continuationAssessment.overallStatus !== "ignored") {
      return "";
    }

    const ignoredHints = continuationAssessment.hints
      .filter((hint) => hint.assessment === "ignored")
      .map(
        (hint) =>
          `- ${hint.sourceToolName}: reason=${hint.reason ?? "unknown"}, strategy=${hint.strategy ?? "unknown"}, detail=${hint.detail}`,
      );

    return [
      "Runtime steering: the previous tool batch ignored one or more continuation hints.",
      "Do not repeat the same broad request shape when a guard or truncation hint already told you to narrow scope.",
      "Prefer a smaller path, more specific pattern, metadata query, or a direct explanation from available evidence.",
      ...(ignoredHints.length > 0 ? ["Ignored hints:", ...ignoredHints] : []),
    ].join("\n");
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

  async previewRequestBudget({ prompt, analysisHint = "" }) {
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
      systemPrompt: [this.systemPrompt, analysisHint].filter(Boolean).join("\n\n"),
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

  async run(userInput, context) {
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
          systemPrompt: [
            this.systemPrompt,
            context.analysisHint,
            this.continuationSteeringHint,
          ]
            .filter(Boolean)
            .join("\n\n"),
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
        this.writeSummary(`ITERATION ${iteration} FINAL`, {
          finishReason: decision.finishReason ?? null,
          warnings: decision.warnings ?? [],
          reasoningPreview: (decision.reasoning ?? "").slice(0, 500),
          outputPreview: decision.output.slice(0, 500),
          usage: decision.usage ?? null,
          usageAvailability: this.usageAvailability(decision),
          requestBudget: this.requestBudget(decision),
          cumulativeUsage: this.usage,
          continuationAssessment: this.pendingContinuationHints.length
            ? {
                availableHintCount: this.pendingContinuationHints.length,
                overallStatus: "answered_without_more_tools",
                hints: this.pendingContinuationHints.map((hint) => ({
                  source: hint.source,
                  sourceIteration: hint.sourceIteration,
                  sourceToolName: hint.sourceToolName,
                  reason: hint.reason,
                  strategy: hint.strategy,
                  suggestedTool: hint.suggestedTool,
                })),
              }
            : null,
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
      const continuationAssessment = this.assessContinuationBatch(currentBatch);
      toolBatchHistory.push(currentBatch);
      const lastThreeBatches = toolBatchHistory.slice(-3);
      const repeatedToolBatchWarning = isRepeatedToolBatch(lastThreeBatches)
        ? "repeated_tool_batch_detected"
        : null;
      const continuationWarning = continuationAssessment?.overallStatus === "ignored"
        ? "continuation_ignored_detected"
        : null;
      const toolBatchWarnings = [
        ...(decision.warnings ?? []),
        ...(repeatedToolBatchWarning ? [repeatedToolBatchWarning] : []),
        ...(continuationWarning ? [continuationWarning] : []),
      ];
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
        continuationAssessment,
        continuationSteeringHintActive: Boolean(this.continuationSteeringHint),
      });
      this.continuationSteeringHint = this.buildContinuationSteeringHint(continuationAssessment);

      if (decision.output?.trim()) {
        this.session.addAssistantMessage(decision.output);
        this.persistSession();
      }

      const toolResults = [];
      const nextContinuationHints = [];
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

        try {
          const toolResult = await this.toolRegistry.execute(toolCall.toolName, toolCall.input, context);
          const preparedToolResult = this.prepareToolResult(toolCall.toolName, toolResult);
          this.session.addToolMessage(toolCall.toolName, {
            ok: true,
            input: toolCall.input,
            toolCallId: toolCall.toolCallId ?? null,
            content: preparedToolResult.content,
            budget: preparedToolResult.budget,
          });
          this.persistSession();
          this.emitRuntimeEvent({
            channel: "tool_execution",
            phase: "finish",
            iteration,
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: true,
            budget: preparedToolResult.budget,
          });
          if (preparedToolResult.budget?.truncated) {
            this.emitRuntimeEvent({
              channel: "tool_result_budget",
              iteration,
              toolName: toolCall.toolName,
              toolCallId: toolCall.toolCallId ?? null,
              budget: preparedToolResult.budget,
            });
          }
          nextContinuationHints.push(
            ...this.extractContinuationHints(
              toolCall.toolName,
              toolCall.input,
              preparedToolResult,
              iteration,
            ),
          );
          toolResults.push({
            toolName: toolCall.toolName,
            toolCallId: toolCall.toolCallId ?? null,
            ok: true,
            continuation: preparedToolResult.content?.continuation ?? null,
            budgetContinuation: preparedToolResult.budget?.continuation ?? null,
            budget: preparedToolResult.budget,
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
      this.pendingContinuationHints = dedupeContinuationHints(nextContinuationHints);
      this.writeSummary(`ITERATION ${iteration} TOOL RESULTS`, toolResults);
    }

    this.writeSummary("RUN FAILED", {
      reason: "max_iterations_exceeded",
      maxIterations: this.maxIterations,
    });
    throw new Error("Agent exceeded max iterations without producing a final answer.");
  }
}
