const COMPACT_CONTINUATION_PREAMBLE =
  "This session is being continued from a previous conversation that ran out of context. The summary below covers the earlier portion of the conversation.";
const COMPACT_RECENT_MESSAGES_NOTE = "Recent messages are preserved verbatim.";
const COMPACT_DIRECT_RESUME_INSTRUCTION =
  "Continue the conversation from where it left off without asking the user any further questions. Resume directly. Do not acknowledge the summary, do not recap what was happening, and do not preface with continuation text.";
const SUMMARY_COMPRESSION_BUDGET = {
  maxChars: Number(process.env.SESSION_SUMMARY_MAX_CHARS ?? 1600),
  maxLines: Number(process.env.SESSION_SUMMARY_MAX_LINES ?? 28),
  maxLineChars: Number(process.env.SESSION_SUMMARY_MAX_LINE_CHARS ?? 180),
};
const SUMMARY_TRANSCRIPT_BUDGET = {
  maxChars: Number(process.env.SESSION_SUMMARY_TRANSCRIPT_MAX_CHARS ?? 24000),
  maxMessages: Number(process.env.SESSION_SUMMARY_TRANSCRIPT_MAX_MESSAGES ?? 24),
  maxMessageChars: Number(process.env.SESSION_SUMMARY_TRANSCRIPT_MAX_MESSAGE_CHARS ?? 1200),
};

function formatTaskPacketBullets(taskPacket) {
  if (!taskPacket) {
    return [];
  }

  const lines = [
    `- Task objective: ${taskPacket.objective}`,
    `- Task scope: ${taskPacket.scope}`,
  ];

  if (taskPacket.repo) {
    lines.push(`- Task repo: ${truncate(taskPacket.repo)}`);
  }

  if (taskPacket.branchPolicy) {
    lines.push(`- Branch policy: ${truncate(taskPacket.branchPolicy)}`);
  }

  if (taskPacket.acceptanceTests?.length > 0) {
    lines.push("- Acceptance criteria:");
    lines.push(...taskPacket.acceptanceTests.map((item) => `  - ${truncate(item)}`));
  }

  if (taskPacket.commitPolicy) {
    lines.push(`- Commit policy: ${truncate(taskPacket.commitPolicy)}`);
  }

  if (taskPacket.reportingContract) {
    lines.push(`- Reporting contract: ${truncate(taskPacket.reportingContract)}`);
  }

  if (taskPacket.escalationPolicy) {
    lines.push(`- Escalation policy: ${truncate(taskPacket.escalationPolicy)}`);
  }

  if (taskPacket.outOfScope?.length > 0) {
    lines.push("- Out of scope:");
    lines.push(...taskPacket.outOfScope.map((item) => `  - ${truncate(item)}`));
  }

  return lines;
}

export function estimateMessageTokens(message) {
  const rendered = typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? {});
  return Math.max(1, Math.ceil(rendered.length / 4));
}

export function estimateSessionTokens(session) {
  return session.messages.reduce((total, message) => total + estimateMessageTokens(message), 0);
}

export function defaultCompactionConfig() {
  const autoCompactInputTokensThreshold = Number(
    process.env.SESSION_AUTO_COMPACT_INPUT_TOKENS ?? 100000,
  );
  const autoCompactRequestBudgetRatio = Number(
    process.env.SESSION_AUTO_COMPACT_REQUEST_BUDGET_RATIO ?? 0.8,
  );
  return {
    preserveRecentMessages: Number(process.env.SESSION_COMPACT_PRESERVE_RECENT_MESSAGES ?? 4),
    maxEstimatedTokens: Number(process.env.SESSION_AUTO_COMPACT_MAX_TOKENS ?? 10000),
    autoCompactInputTokensThreshold,
    autoCompactMinInputTokensDelta: Number(
      process.env.SESSION_AUTO_COMPACT_MIN_INPUT_TOKENS_DELTA ?? autoCompactInputTokensThreshold,
    ),
    autoCompactRequestBudgetRatio:
      Number.isFinite(autoCompactRequestBudgetRatio) &&
      autoCompactRequestBudgetRatio > 0 &&
      autoCompactRequestBudgetRatio < 1
        ? autoCompactRequestBudgetRatio
        : 0.8,
    summaryMode: process.env.SESSION_COMPACT_SUMMARY_MODE ?? "auto",
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

function summarizeMessages(messages, taskPacket = null) {
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

  lines.push(...formatTaskPacketBullets(taskPacket));

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

function renderCompactionTranscriptMessage(message) {
  const createdAt = message.createdAt ?? "unknown-time";

  if (typeof message.content === "string") {
    return `[${createdAt}] ${message.role}: ${truncate(message.content, SUMMARY_TRANSCRIPT_BUDGET.maxMessageChars)}`;
  }

  if (message.role === "assistant" && message.content?.type === "final_answer") {
    return `[${createdAt}] assistant(final_answer): ${truncate(message.content.output ?? "", SUMMARY_TRANSCRIPT_BUDGET.maxMessageChars)}`;
  }

  if (message.role === "assistant" && message.content?.type === "tool_request") {
    return `[${createdAt}] assistant(tool_request): ${truncate(
      `${message.content.toolName}(${JSON.stringify(message.content.input ?? {})})`,
      SUMMARY_TRANSCRIPT_BUDGET.maxMessageChars,
    )}`;
  }

  if (message.role === "tool") {
    if (message.content?.ok) {
      return `[${createdAt}] tool(${message.content.toolName} ok): ${truncate(
        JSON.stringify(message.content.content ?? {}),
        SUMMARY_TRANSCRIPT_BUDGET.maxMessageChars,
      )}`;
    }

    return `[${createdAt}] tool(${message.content?.toolName} error): ${truncate(
      message.content?.error ?? "unknown error",
      SUMMARY_TRANSCRIPT_BUDGET.maxMessageChars,
    )}`;
  }

  return `[${createdAt}] ${message.role}: ${truncate(
    JSON.stringify(message.content ?? {}),
    SUMMARY_TRANSCRIPT_BUDGET.maxMessageChars,
  )}`;
}

function buildCompactionTranscript(messages) {
  const lines = messages
    .slice(-SUMMARY_TRANSCRIPT_BUDGET.maxMessages)
    .map((message) => renderCompactionTranscriptMessage(message));
  const transcript = lines.join("\n");
  if (transcript.length <= SUMMARY_TRANSCRIPT_BUDGET.maxChars) {
    return transcript;
  }

  return `${transcript.slice(0, SUMMARY_TRANSCRIPT_BUDGET.maxChars - 1)}…`;
}

async function generateLlmSummary({
  model,
  systemPrompt,
  existingSummary,
  removedMessages,
  taskPacket = null,
  iterationLabel = "compaction",
}) {
  const transcript = buildCompactionTranscript(removedMessages);
  const userPrompt = [
    "Summarize the earlier conversation for context compaction.",
    "Return only a single <summary>...</summary> block.",
    "Do not include markdown fences, explanations, or any text outside the summary tags.",
    "Preserve: task objective, task scope, acceptance criteria, out-of-scope boundaries, recent user goals, tools used, current work, key file/doc names, errors, and unresolved work.",
    "Be concise and factual.",
    taskPacket
      ? [
          "Pinned task context:",
          `Objective: ${taskPacket.objective}`,
          `Scope: ${taskPacket.scope}`,
          ...(taskPacket.repo ? [`Repo: ${taskPacket.repo}`] : []),
          ...(taskPacket.branchPolicy ? [`Branch policy: ${taskPacket.branchPolicy}`] : []),
          ...(taskPacket.acceptanceTests?.length
            ? ["Acceptance criteria:", ...taskPacket.acceptanceTests.map((item) => `- ${item}`)]
            : []),
          ...(taskPacket.commitPolicy ? [`Commit policy: ${taskPacket.commitPolicy}`] : []),
          ...(taskPacket.reportingContract ? [`Reporting contract: ${taskPacket.reportingContract}`] : []),
          ...(taskPacket.escalationPolicy ? [`Escalation policy: ${taskPacket.escalationPolicy}`] : []),
          ...(taskPacket.outOfScope?.length
            ? ["Out of scope:", ...taskPacket.outOfScope.map((item) => `- ${item}`)]
            : []),
        ].join("\n")
      : "Pinned task context:\n(none)",
    existingSummary
      ? `Existing earlier compacted summary:\n${formatCompactSummary(existingSummary)}`
      : "Existing earlier compacted summary:\n(none)",
    "Newly compacted transcript:",
    transcript || "(empty)",
  ].join("\n\n");

  const decision = await model.decide({
    systemPrompt: [systemPrompt, "You generate compact continuation summaries for long-running coding-agent sessions."].filter(Boolean).join("\n\n"),
    messages: [
      {
        role: "user",
        content: userPrompt,
        createdAt: new Date().toISOString(),
      },
    ],
    tools: [],
    iteration: iterationLabel,
    onAssistantEvent: null,
  });

  if (decision.type !== "final") {
    throw new Error(`Compaction summarizer returned unsupported decision type: ${decision.type}`);
  }

  const output = decision.output?.trim() ?? "";
  if (!output) {
    throw new Error("Compaction summarizer returned empty output.");
  }

  const hasSummaryTags = output.includes("<summary>") && output.includes("</summary>");
  return hasSummaryTags ? output : `<summary>\n${output}\n</summary>`;
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

function stripBulletPrefix(line) {
  if (line.startsWith("  - ")) {
    return line.slice(4);
  }

  if (line.startsWith("- ")) {
    return line.slice(2);
  }

  return line;
}

function normalizeSummaryLine(line) {
  const content = stripBulletPrefix(line);

  if (content.startsWith("Task objective:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Task:")) {
    return `- Task objective:${content.slice("Task:".length)}`;
  }

  if (content.startsWith("Task scope:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Scope:")) {
    return line.startsWith("- ") ? `- ${content}` : `- Task scope:${content.slice("Scope:".length)}`;
  }

  if (content.startsWith("Acceptance criteria:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Out of scope:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Tools mentioned:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Tools used:")) {
    return `- Tools mentioned:${content.slice("Tools used:".length)}`;
  }

  if (content.startsWith("Current work:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Recent user requests:")) {
    return `- ${content}`;
  }

  if (content.startsWith("Key timeline:")) {
    return "- Key timeline:";
  }

  return line;
}

function normalizeSummaryLines(summary) {
  return formatCompactSummary(summary)
    .split("\n")
    .map((line) => truncateLine(normalizeSummaryLine(line)))
    .filter(Boolean);
}

function hasMeaningfulSummaryContent(summary) {
  return normalizeSummaryLines(summary).some((line) => {
    return line !== "Conversation summary:" && line !== "Summary:";
  });
}

function buildFallbackMergedSummary(existingSummary, newSummary) {
  const previousLines = normalizeSummaryLines(existingSummary).filter((line) => {
    return line !== "Conversation summary:" && line !== "Summary:";
  });
  const nextLines = normalizeSummaryLines(newSummary).filter((line) => {
    return line !== "Conversation summary:" && line !== "Summary:";
  });

  return `<summary>\n${compressSummaryText([
    "Conversation summary:",
    ...(previousLines.length > 0
      ? ["- Previously compacted context:", ...previousLines.map((line) => asNestedBullet(line))]
      : []),
    ...(nextLines.length > 0
      ? ["- Newly compacted context:", ...nextLines.map((line) => asNestedBullet(line))]
      : []),
  ].join("\n"))}\n</summary>`;
}

function extractSummaryHighlights(summary) {
  const lines = normalizeSummaryLines(summary);

  const highlights = [];
  let scopeLine = null;
  let taskObjectiveLine = null;
  let taskScopeLine = null;
  let toolsLine = null;
  let currentWorkLine = null;
  const noteLines = [];
  let inAcceptanceCriteria = false;
  const acceptanceItems = [];
  let inOutOfScope = false;
  const outOfScopeItems = [];
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
      inAcceptanceCriteria = false;
      inOutOfScope = false;
      continue;
    }

    if (line.startsWith("- Task objective:")) {
      taskObjectiveLine = line;
      inRecentRequests = false;
      inAcceptanceCriteria = false;
      inOutOfScope = false;
      continue;
    }

    if (line.startsWith("- Task scope:")) {
      taskScopeLine = line;
      inRecentRequests = false;
      inAcceptanceCriteria = false;
      inOutOfScope = false;
      continue;
    }

    if (line.startsWith("- Acceptance criteria:")) {
      const inlineValue = line.slice("- Acceptance criteria:".length).trim();
      if (inlineValue) {
        highlights.push(`- Acceptance criteria: ${inlineValue}`);
        inAcceptanceCriteria = false;
      } else {
        inAcceptanceCriteria = true;
      }
      inRecentRequests = false;
      inOutOfScope = false;
      continue;
    }

    if (line.startsWith("- Out of scope:")) {
      const inlineValue = line.slice("- Out of scope:".length).trim();
      if (inlineValue) {
        highlights.push(`- Out of scope: ${inlineValue}`);
        inOutOfScope = false;
      } else {
        inOutOfScope = true;
      }
      inRecentRequests = false;
      inAcceptanceCriteria = false;
      continue;
    }

    if (line.startsWith("- Tools mentioned:")) {
      toolsLine = line;
      inRecentRequests = false;
      inAcceptanceCriteria = false;
      inOutOfScope = false;
      continue;
    }

    if (line.startsWith("- Current work:")) {
      currentWorkLine = line;
      inRecentRequests = false;
      inAcceptanceCriteria = false;
      inOutOfScope = false;
      continue;
    }

    if (line.startsWith("- Recent user requests:")) {
      const inlineValue = line.slice("- Recent user requests:".length).trim();
      if (inlineValue) {
        highlights.push(`- Recent user requests: ${inlineValue}`);
        inRecentRequests = false;
      } else {
        inRecentRequests = true;
      }
      continue;
    }

    if (inRecentRequests && line.startsWith("  - ")) {
      if (recentRequestItems.length < 3) {
        recentRequestItems.push(line);
      }
      continue;
    }

    if (inAcceptanceCriteria && line.startsWith("  - ")) {
      if (acceptanceItems.length < 4) {
        acceptanceItems.push(line);
      }
      continue;
    }

    if (inOutOfScope && line.startsWith("  - ")) {
      if (outOfScopeItems.length < 3) {
        outOfScopeItems.push(line);
      }
      continue;
    }

    if (!line.startsWith("  - ")) {
      inRecentRequests = false;
      inAcceptanceCriteria = false;
      inOutOfScope = false;
    }

    if (line.startsWith("- ")) {
      if (
        !line.startsWith("- Scope:") &&
        !line.startsWith("- Task objective:") &&
        !line.startsWith("- Task scope:") &&
        !line.startsWith("- Acceptance criteria:") &&
        !line.startsWith("- Out of scope:") &&
        !line.startsWith("- Tools mentioned:") &&
        !line.startsWith("- Current work:") &&
        !line.startsWith("- Recent user requests:")
      ) {
        if (noteLines.length < 6) {
          noteLines.push(line);
        }
      }
      continue;
    }

    if (noteLines.length < 6) {
      noteLines.push(`- ${line}`);
    }
  }

  if (scopeLine) {
    highlights.push(scopeLine);
  }
  if (taskObjectiveLine) {
    highlights.push(taskObjectiveLine);
  }
  if (taskScopeLine) {
    highlights.push(taskScopeLine);
  }
  if (acceptanceItems.length > 0) {
    highlights.push("- Acceptance criteria:");
    highlights.push(...acceptanceItems);
  }
  if (outOfScopeItems.length > 0) {
    highlights.push("- Out of scope:");
    highlights.push(...outOfScopeItems);
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
  if (noteLines.length > 0) {
    highlights.push(...noteLines);
  }

  return highlights;
}

function extractSummaryTimeline(summary) {
  const lines = normalizeSummaryLines(summary);
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

  const mergedSummary = `<summary>\n${compressSummaryText([
    "Conversation summary:",
    ...(previousHighlights.length > 0
      ? ["- Previously compacted context:", ...previousHighlights.map((line) => asNestedBullet(line))]
      : []),
    ...(newHighlights.length > 0
      ? ["- Newly compacted context:", ...newHighlights.map((line) => asNestedBullet(line))]
      : []),
    ...(newTimeline.length > 0 ? ["- Key timeline:", ...newTimeline.map((line) => asNestedBullet(line))] : []),
  ].join("\n"))}\n</summary>`;

  if (hasMeaningfulSummaryContent(mergedSummary)) {
    return mergedSummary;
  }

  return buildFallbackMergedSummary(existingSummary, newSummary);
}

export function compactSession(session, config = defaultCompactionConfig(), options = {}) {
  const { force = false, lastCompactionInputTokens = null } = options;

  if (!force && !shouldCompact(session, config)) {
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
  if (removedMessages.length === 0) {
    return {
      summary: existingSummary ?? "",
      formattedSummary: formatCompactSummary(existingSummary ?? ""),
      compactedSession: session,
      removedMessageCount: 0,
    };
  }
  const preservedMessages = session.messages.slice(keepFrom);
  const newSummary = summarizeMessages(removedMessages, session.taskPacket);
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
    lastCompactionInputTokens,
  });

  return {
    summary: mergedSummary,
    formattedSummary: formatCompactSummary(mergedSummary),
    compactedSession,
    removedMessageCount: removedMessages.length,
    summaryMode: "heuristic",
    summaryError: null,
  };
}

export async function compactSessionWithStrategy(
  session,
  config = defaultCompactionConfig(),
  options = {},
) {
  const { model = null, systemPrompt = "", iteration = "compaction", ...rest } = options;

  const existingSummary = existingCompactedSummary(session);
  const summaryPrefixLength = existingSummary ? 1 : 0;
  const keepFrom = Math.max(session.messages.length - config.preserveRecentMessages, summaryPrefixLength);
  const removedMessages = session.messages.slice(summaryPrefixLength, keepFrom);

  if (config.summaryMode === "heuristic" || !model || removedMessages.length === 0) {
    return compactSession(session, config, rest);
  }

  try {
    const llmSummary = await generateLlmSummary({
      model,
      systemPrompt,
      existingSummary,
      removedMessages,
      taskPacket: session.taskPacket,
      iterationLabel: `${iteration}-compaction-summary`,
    });
    const mergedSummary = existingSummary ? mergeCompactSummaries(existingSummary, llmSummary) : llmSummary;
    const preservedMessages = session.messages.slice(keepFrom);
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
      lastCompactionInputTokens: rest.lastCompactionInputTokens ?? null,
    });
    return {
      summary: mergedSummary,
      formattedSummary: formatCompactSummary(mergedSummary),
      compactedSession,
      removedMessageCount: removedMessages.length,
      summaryMode: "llm",
      summaryError: null,
    };
  } catch (error) {
    const fallback = compactSession(session, config, rest);
    return {
      ...fallback,
      summaryMode: "heuristic_fallback",
      summaryError: error instanceof Error ? error.message : String(error),
    };
  }
}
