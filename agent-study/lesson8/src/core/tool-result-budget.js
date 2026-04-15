import { createContinuation } from "../tools/tool-continuation.js";

function truncateText(text, maxChars) {
  const normalized = String(text ?? "");
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, Math.max(0, maxChars - 1))}…`;
}

function estimateSerializedChars(value) {
  try {
    return JSON.stringify(value ?? null).length;
  } catch {
    return String(value ?? "").length;
  }
}

function classifyValue(value) {
  if (Array.isArray(value)) {
    return "array";
  }
  if (value === null) {
    return "null";
  }
  return typeof value;
}

function summarizeValue(value, maxChars) {
  if (typeof value === "string") {
    return truncateText(value, maxChars);
  }

  try {
    return truncateText(JSON.stringify(value ?? null), maxChars);
  } catch {
    return truncateText(String(value ?? ""), maxChars);
  }
}

function sanitizeValue(value, config, stats, depth = 0) {
  if (value === null || typeof value === "number" || typeof value === "boolean") {
    return value;
  }

  if (typeof value === "string") {
    if (value.length > config.maxStringChars) {
      stats.truncated = true;
      stats.stringsTruncated += 1;
      return truncateText(value, config.maxStringChars);
    }
    return value;
  }

  if (depth >= config.maxDepth) {
    stats.truncated = true;
    stats.depthLimited = true;
    return summarizeValue(value, config.depthPreviewChars);
  }

  if (Array.isArray(value)) {
    const keptItems = value.slice(0, config.maxArrayItems).map((item) =>
      sanitizeValue(item, config, stats, depth + 1),
    );
    const omittedItems = Math.max(0, value.length - keptItems.length);
    if (omittedItems > 0) {
      stats.truncated = true;
      stats.arrayItemsRemoved += omittedItems;
    }
    return keptItems;
  }

  if (typeof value === "object") {
    const entries = Object.entries(value);
    const keptEntries = entries.slice(0, config.maxObjectKeys);
    const omittedKeys = Math.max(0, entries.length - keptEntries.length);
    if (omittedKeys > 0) {
      stats.truncated = true;
      stats.objectKeysRemoved += omittedKeys;
    }

    const next = {};
    for (const [key, child] of keptEntries) {
      next[key] = sanitizeValue(child, config, stats, depth + 1);
    }
    return next;
  }

  return summarizeValue(value, config.depthPreviewChars);
}

function fitTextWithinSerializedBudget(text, maxSerializedChars) {
  const normalized = String(text ?? "");
  if (estimateSerializedChars(normalized) <= maxSerializedChars) {
    return normalized;
  }

  let low = 0;
  let high = normalized.length;
  let best = "";

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = truncateText(normalized, mid);
    if (estimateSerializedChars(candidate) <= maxSerializedChars) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function fitObjectWithPreviewWithinBudget(base, previewText, maxSerializedChars) {
  const emptyCandidate = {
    ...base,
    preview: "",
  };

  if (estimateSerializedChars(emptyCandidate) > maxSerializedChars) {
    return null;
  }

  if (estimateSerializedChars({ ...base, preview: previewText }) <= maxSerializedChars) {
    return { ...base, preview: previewText };
  }

  let low = 0;
  let high = previewText.length;
  let best = emptyCandidate;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const candidate = {
      ...base,
      preview: truncateText(previewText, mid),
    };
    if (estimateSerializedChars(candidate) <= maxSerializedChars) {
      best = candidate;
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }

  return best;
}

function buildSummaryFallback(toolName, value, config, originalEstimatedChars, maxSerializedChars) {
  const previewText = summarizeValue(value, config.summaryPreviewChars);
  const continuation = createContinuation({
    reason: "session_tool_result_budget",
    summary: "The tool result was reduced before being written back to session history because it exceeded the session tool-result budget.",
    strategy: "narrow_result_scope",
    suggestedTool: toolName,
    suggestedActions: [
      "Retry with a narrower path, smaller scope, or more specific query.",
      "Prefer targeted follow-up commands over re-requesting a broad result.",
    ],
  });
  const objectVariants = [
    {
      toolName,
      truncated: true,
      reason: "session_tool_result_budget",
      originalType: classifyValue(value),
      originalEstimatedChars,
      continuation,
    },
    {
      toolName,
      truncated: true,
      originalEstimatedChars,
      continuation,
    },
    {
      toolName,
      truncated: true,
      continuation,
    },
  ];

  for (const base of objectVariants) {
    const fitted = fitObjectWithPreviewWithinBudget(base, previewText, maxSerializedChars);
    if (fitted) {
      return {
        content: fitted,
        method: "summary_fallback",
      };
    }
  }

  return {
    content: fitTextWithinSerializedBudget(
      `[${toolName}] truncated tool result (${originalEstimatedChars} chars)`,
      maxSerializedChars,
    ),
    method: "string_fallback",
  };
}

function maybeAttachBudgetContinuation(content, toolName, maxSerializedChars) {
  if (!content || typeof content !== "object" || Array.isArray(content) || content.continuation) {
    return content;
  }

  const withContinuation = {
    ...content,
    continuation: createContinuation({
      reason: "session_tool_result_budget",
      summary:
        "This tool result was truncated before being written back to session history because it exceeded the session tool-result budget.",
      strategy: "narrow_result_scope",
      suggestedTool: toolName,
      suggestedActions: [
        "Narrow the next tool call so it returns a smaller result.",
        "Prefer a more specific query, path, symbol, or subrange instead of retrying the full request.",
      ],
    }),
  };

  return estimateSerializedChars(withContinuation) <= maxSerializedChars ? withContinuation : content;
}

export function defaultToolResultBudgetConfig() {
  return {
    maxSerializedChars: Number(process.env.SESSION_TOOL_RESULT_MAX_CHARS ?? 12000),
    maxStringChars: Number(process.env.SESSION_TOOL_RESULT_MAX_STRING_CHARS ?? 4000),
    maxArrayItems: Number(process.env.SESSION_TOOL_RESULT_MAX_ARRAY_ITEMS ?? 80),
    maxObjectKeys: Number(process.env.SESSION_TOOL_RESULT_MAX_OBJECT_KEYS ?? 40),
    maxDepth: Number(process.env.SESSION_TOOL_RESULT_MAX_DEPTH ?? 6),
    depthPreviewChars: Number(process.env.SESSION_TOOL_RESULT_DEPTH_PREVIEW_CHARS ?? 400),
    summaryPreviewChars: Number(process.env.SESSION_TOOL_RESULT_SUMMARY_PREVIEW_CHARS ?? 2000),
  };
}

export function applyToolResultBudget(
  toolName,
  value,
  config = defaultToolResultBudgetConfig(),
) {
  const originalEstimatedChars = estimateSerializedChars(value);
  const stats = {
    truncated: false,
    stringsTruncated: 0,
    arrayItemsRemoved: 0,
    objectKeysRemoved: 0,
    depthLimited: false,
    method: "structured_truncation",
  };

  const budgetContinuation = createContinuation({
    reason: "session_tool_result_budget",
    summary:
      "This tool result was reduced before being written back to session history because it exceeded the session tool-result budget.",
    strategy: "narrow_result_scope",
    suggestedTool: toolName,
    suggestedActions: [
      "Narrow the next tool call so it returns a smaller result.",
      "Prefer a more specific query, path, symbol, or subrange instead of retrying the full request.",
    ],
  });

  let content = sanitizeValue(value, config, stats);
  let storedEstimatedChars = estimateSerializedChars(content);

  if (storedEstimatedChars > config.maxSerializedChars) {
    stats.truncated = true;
    const fallback = buildSummaryFallback(
      toolName,
      value,
      config,
      originalEstimatedChars,
      config.maxSerializedChars,
    );
    stats.method = fallback.method;
    content = fallback.content;
    storedEstimatedChars = estimateSerializedChars(content);
  }

  if (stats.truncated) {
    content = maybeAttachBudgetContinuation(content, toolName, config.maxSerializedChars);
    storedEstimatedChars = estimateSerializedChars(content);
  }

  return {
    content,
    budget: stats.truncated
      ? {
          truncated: true,
          reason: "session_tool_result_budget",
          method: stats.method,
          originalEstimatedChars,
          storedEstimatedChars,
          stringsTruncated: stats.stringsTruncated,
          arrayItemsRemoved: stats.arrayItemsRemoved,
          objectKeysRemoved: stats.objectKeysRemoved,
          depthLimited: stats.depthLimited,
          continuation: budgetContinuation,
        }
      : null,
  };
}
