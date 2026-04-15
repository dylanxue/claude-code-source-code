function parseOptionalInt(value) {
  if (!value) {
    return null;
  }

  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export function modelTokenLimit(model) {
  const normalized = String(model ?? "").toLowerCase();

  if (normalized.includes("claude-opus")) {
    return {
      maxOutputTokens: 32_000,
      contextWindowTokens: 200_000,
    };
  }

  if (
    normalized.includes("claude-sonnet") ||
    normalized.includes("claude-haiku") ||
    normalized.includes("minimax")
  ) {
    return {
      maxOutputTokens: 64_000,
      contextWindowTokens: 204_800,
    };
  }

  if (normalized.includes("grok-3")) {
    return {
      maxOutputTokens: 64_000,
      contextWindowTokens: 131_072,
    };
  }

  return null;
}

export function maxOutputTokensForModel(model) {
  const limit = modelTokenLimit(model);
  if (limit) {
    return limit.maxOutputTokens;
  }

  return String(model ?? "").toLowerCase().includes("opus") ? 32_000 : 64_000;
}

export function maxOutputTokensForModelWithOverride(model, override = null) {
  return override ?? maxOutputTokensForModel(model);
}

export function configuredMaxOutputTokens() {
  return parseOptionalInt(process.env.LLM_MAX_OUTPUT_TOKENS);
}

export function estimateInputTokens(payload) {
  const rendered = JSON.stringify(payload);
  return Math.max(1, Math.ceil(rendered.length / 4));
}

export function preflightTokenBudget({ model, requestPayload, maxOutputTokens }) {
  const limit = modelTokenLimit(model);
  const estimatedInputTokens = estimateInputTokens(requestPayload);
  const estimatedTotalTokens = estimatedInputTokens + maxOutputTokens;

  if (!limit) {
    return {
      estimatedInputTokens,
      estimatedTotalTokens,
      contextWindowTokens: null,
      exceeded: false,
    };
  }

  return {
    estimatedInputTokens,
    estimatedTotalTokens,
    contextWindowTokens: limit.contextWindowTokens,
    exceeded: estimatedTotalTokens > limit.contextWindowTokens,
  };
}
