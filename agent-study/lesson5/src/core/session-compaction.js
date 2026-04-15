const COMPACT_CONTINUATION_PREAMBLE =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.";
const COMPACT_RECENT_MESSAGES_NOTE = "Recent messages are preserved verbatim.";
const COMPACT_DIRECT_RESUME_INSTRUCTION =
  "Continue the conversation from where it left off without asking the user any further questions. Resume directly and do not recap the summary.";
const SUMMARY_COMPRESSION_BUDGET = {
  maxChars: Number(process.env.SESSION_SUMMARY_MAX_CHARS ?? 1600),
  maxLines: Number(process.env.SESSION_SUMMARY_MAX_LINES ?? 28),
  maxLineChars: Number(process.env.SESSION_SUMMARY_MAX_LINE_CHARS ?? 180),
};

export function estimateMessageTokens(message) {
  const rendered = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? {});
  return Math.max(1, Math.ceil(rendered.length / 4));
}

export function estimateSessionTokens(session) {
  return session.messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function defaultCompactionConfig() {
  return {
    preserveRecentMessages: Number(process.env.SESSION_COMPACT_PRESERVE_RECENT_MESSAGES ?? 8),
    maxEstimatedTokens: Number(process.env.SESSION_AUTO_COMPACT_MAX_TOKENS ?? 1200),
  };
}

export function shouldCompact(session, config = defaultCompactionConfig()) {
  const summaryPrefixLength = existingCompactedSummary(session) ? 1 : 0;
  const compactableMessages = session.messages.slice(summaryPrefixLength);

  return (
    compactableMessages.length > config.preserveRecentMessages &&
    estimateSessionTokens({ messages: compactableMessages }) >= config.maxEstimatedTokens
  );
}

export function formatCompactSummary(summary) {
  return summary.replace(/^<summary>\s*/u, "").replace(/\s*<\/summary>$/u, "").trim();
}

export function getCompactContinuationMessage(summary, recentMessagesPreserved = true) {
  const lines = [COMPACT_CONTINUATION_PREAMBLE, "", formatCompactSummary(summary)];

  if (recentMessagesPreserved) {
    lines.push("", COMPACT_RECENT_MESSAGES_NOTE);
  }

  lines.push("", COMPACT_DIRECT_RESUME_INSTRUCTION);
  return lines.join("\n").trim();
}

function truncate(text, maxChars = 160) {
  const normalized = text.replace(/\s+/g, " ").trim();
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1)}…`;
}

function summarizeMessage(message) {
  if (typeof message.content === "string") {
    return truncate(message.content);
  }

  if (message.role === "assistant" && message.content?.type === "final_answer") {
    return truncate(message.content.output ?? "");
  }

  if (message.role === "assistant" && message.content?.type === "tool_request") {
    return truncate(`tool request ${message.content.toolName}(${JSON.stringify(message.content.input ?? {})})`);
  }

  if (message.role === "tool") {
    if (message.content?.ok) {
      return truncate(`tool result ${message.content.toolName}: ${JSON.stringify(message.content.content ?? {})}`);
    }

    return truncate(`tool error ${message.content?.toolName}: ${message.content?.error ?? "unknown error"}`);
  }

  return truncate(JSON.stringify(message.content ?? {}));
}

function collectRecentUserRequests(messages, limit = 3) {
  return messages
    .filter((message) => message.role === "user" && typeof message.content === "string")
    .slice(-limit)
    .map((message) => truncate(message.content));
}

function collectToolNames(messages) {
  return [...new Set(
    messages.flatMap((message) => {
      if (message.role === "assistant" && message.content?.type === "tool_request") {
        return [message.content.toolName];
      }

      if (message.role === "tool" && message.content?.toolName) {
        return [message.content.toolName];
      }

      return [];
    }),
  )].sort();
}

function inferCurrentWork(messages) {
  const latest = [...messages].reverse().find((message) => {
    return (
      typeof message.content === "string" ||
      (message.role === "assistant" && message.content?.type === "final_answer") ||
      (message.role === "tool" && message.content?.toolName)
    );
  });

  return latest ? summarizeMessage(latest) : null;
}

function buildTimeline(messages) {
  return messages.slice(-8).map((message) => `  - ${message.role}: ${summarizeMessage(message)}`);
}

function summarizeMessages(messages) {
  const userCount = messages.filter((message) => message.role === "user").length;
  const assistantCount = messages.filter((message) => message.role === "assistant").length;
  const toolCount = messages.filter((message) => message.role === "tool").length;
  const toolNames = collectToolNames(messages);
  const recentUserRequests = collectRecentUserRequests(messages);
  const currentWork = inferCurrentWork(messages);

  const lines = [
    "<summary>",
    "Conversation summary:",
    `- Scope: ${messages.length} earlier messages compacted (user=${userCount}, assistant=${assistantCount}, tool=${toolCount}).`,
  ];

  if (toolNames.length > 0) {
    lines.push(`- Tools mentioned: ${toolNames.join(", ")}.`);
  }

  if (recentUserRequests.length > 0) {
    lines.push("- Recent user requests:");
    for (const request of recentUserRequests) {
      lines.push(`  - ${request}`);
    }
  }

  if (currentWork) {
    lines.push(`- Current work: ${currentWork}`);
  }

  lines.push("- Key timeline:");
  lines.push(...buildTimeline(messages));
  lines.push("</summary>");

  return lines.join("\n");
}

function existingCompactedSummary(session) {
  const firstMessage = session.messages[0];
  if (firstMessage?.role !== "system" || typeof firstMessage.content !== "string") {
    return null;
  }

  if (!firstMessage.content.startsWith(COMPACT_CONTINUATION_PREAMBLE)) {
    return null;
  }

  const stripped = firstMessage.content.replace(COMPACT_CONTINUATION_PREAMBLE, "").trim();
  const withoutRecent = stripped.replace(COMPACT_RECENT_MESSAGES_NOTE, "").trim();
  const withoutInstruction = withoutRecent.replace(COMPACT_DIRECT_RESUME_INSTRUCTION, "").trim();
  return withoutInstruction || null;
}

function collapseInlineWhitespace(line) {
  let prefix = "";
  let content = line;
  const leadingSpaces = line.match(/^ */u)?.[0].length ?? 0;
  const trimmedStart = line.trimStart();

  if (trimmedStart.startsWith("- ")) {
    prefix = leadingSpaces >= 2 ? "  - " : "- ";
    content = trimmedStart.slice(2);
  } else {
    content = trimmedStart;
  }

  const collapsed = content.split(/\s+/u).filter(Boolean).join(" ").trim();
  return `${prefix}${collapsed}`.trimEnd();
}

function asNestedBullet(line) {
  const normalized = truncateLine(line);
  if (!normalized) {
    return normalized;
  }

  if (normalized.startsWith("  - ")) {
    return normalized;
  }

  if (normalized.startsWith("- ")) {
    return `  ${normalized}`;
  }

  return `  - ${normalized}`;
}

function truncateLine(line, maxChars = SUMMARY_COMPRESSION_BUDGET.maxLineChars) {
  const normalized = collapseInlineWhitespace(line);
  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1)}…`;
}

function joinedCharCount(lines) {
  return lines.reduce((total, line) => total + line.length, 0) + Math.max(0, lines.length - 1);
}

function compressSummaryText(summary) {
  const seen = new Set();
  const normalizedLines = [];

  for (const rawLine of formatCompactSummary(summary).split("\n")) {
    const line = truncateLine(rawLine);
    if (!line) {
      continue;
    }

    const key = line.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    normalizedLines.push(line);
  }

  const selected = [];
  for (const line of normalizedLines) {
    const candidate = [...selected, line];
    if (candidate.length > SUMMARY_COMPRESSION_BUDGET.maxLines) {
      break;
    }

    if (joinedCharCount(candidate) > SUMMARY_COMPRESSION_BUDGET.maxChars) {
      break;
    }

    selected.push(line);
  }

  const omitted = normalizedLines.length - selected.length;
  if (omitted > 0) {
    const omissionLine = `- … ${omitted} additional line(s) omitted.`;
    const candidate = [...selected, omissionLine];
    if (
      candidate.length <= SUMMARY_COMPRESSION_BUDGET.maxLines &&
      joinedCharCount(candidate) <= SUMMARY_COMPRESSION_BUDGET.maxChars
    ) {
      selected.push(omissionLine);
    }
  }

  return selected.join("\n");
}

function extractSummaryHighlights(summary) {
  const lines = formatCompactSummary(summary)
    .split("\n")
    .map((line) => truncateLine(line))
    .filter(Boolean);

  const highlights = [];
  let scopeLine = null;
  let toolsLine = null;
  let currentWorkLine = null;
  let inRecentRequests = false;
  const recentRequestItems = [];

  for (const line of lines) {
    if (line === "Conversation summary:" || line === "Summary:") {
      continue;
    }

    if (line === "- Key timeline:") {
      break;
    }

    if (line.startsWith("- Scope:")) {
      scopeLine = line;
      inRecentRequests = false;
      continue;
    }

    if (line.startsWith("- Tools mentioned:")) {
      toolsLine = line;
      inRecentRequests = false;
      continue;
    }

    if (line.startsWith("- Current work:")) {
      currentWorkLine = line;
      inRecentRequests = false;
      continue;
    }

    if (line.startsWith("- Recent user requests:")) {
      inRecentRequests = true;
      continue;
    }

    if (inRecentRequests && line.startsWith("  - ")) {
      if (recentRequestItems.length < 3) {
        recentRequestItems.push(line);
      }
      continue;
    }

    if (!line.startsWith("  - ")) {
      inRecentRequests = false;
    }
  }

  if (scopeLine) {
    highlights.push(scopeLine);
  }
  if (toolsLine) {
    highlights.push(toolsLine);
  }
  if (recentRequestItems.length > 0) {
    highlights.push("- Recent user requests:");
    highlights.push(...recentRequestItems);
  }
  if (currentWorkLine) {
    highlights.push(currentWorkLine);
  }

  return highlights;
}

function extractSummaryTimeline(summary) {
  const lines = formatCompactSummary(summary)
    .split("\n")
    .map((line) => truncateLine(line))
    .filter(Boolean);
  const start = lines.findIndex((line) => line === "- Key timeline:");
  if (start === -1) {
    return [];
  }

  return lines.slice(start + 1).filter((line) => line.startsWith("  - "));
}

function mergeCompactSummaries(existingSummary, newSummary) {
  if (!existingSummary) {
    return `<summary>\n${compressSummaryText(newSummary)}\n</summary>`;
  }

  const previousHighlights = extractSummaryHighlights(existingSummary);
  const newHighlights = extractSummaryHighlights(newSummary);
  const newTimeline = extractSummaryTimeline(newSummary);

  return `<summary>\n${compressSummaryText([
    "Conversation summary:",
    ...(previousHighlights.length > 0
      ? ["- Previously compacted context:", ...previousHighlights.map((line) => asNestedBullet(line))]
      : []),
    ...(newHighlights.length > 0
      ? ["- Newly compacted context:", ...newHighlights.map((line) => asNestedBullet(line))]
      : []),
    ...(newTimeline.length > 0 ? ["- Key timeline:", ...newTimeline.map((line) => asNestedBullet(line))] : []),
  ].join("\n"))}\n</summary>`;
}

export function compactSession(session, config = defaultCompactionConfig()) {
  if (!shouldCompact(session, config)) {
    return {
      summary: "",
      formattedSummary: "",
      compactedSession: session,
      removedMessageCount: 0,
    };
  }

  const existingSummary = existingCompactedSummary(session);
  const summaryPrefixLength = existingSummary ? 1 : 0;
  const keepFrom = Math.max(session.messages.length - config.preserveRecentMessages, summaryPrefixLength);
  const removedMessages = session.messages.slice(summaryPrefixLength, keepFrom);
  const preservedMessages = session.messages.slice(keepFrom);
  const newSummary = summarizeMessages(removedMessages);
  const mergedSummary = mergeCompactSummaries(existingSummary, newSummary);
  const continuationMessage = getCompactContinuationMessage(mergedSummary, preservedMessages.length > 0);

  const compactedSession = session.clone({
    messages: [
      {
        role: "system",
        content: continuationMessage,
        createdAt: new Date().toISOString(),
      },
      ...preservedMessages,
    ],
  });

  compactedSession.recordCompaction({
    summary: mergedSummary,
    removedMessageCount: removedMessages.length,
  });

  return {
    summary: mergedSummary,
    formattedSummary: formatCompactSummary(mergedSummary),
    compactedSession,
    removedMessageCount: removedMessages.length,
  };
}
