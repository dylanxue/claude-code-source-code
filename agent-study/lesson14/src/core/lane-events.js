function normalizeDetail(value) {
  const normalized = String(value ?? "").replace(/\s+/g, " ").trim();
  return normalized || null;
}

function compressSummaryText(value, maxChars = 120) {
  const normalized = normalizeDetail(value);
  if (!normalized) {
    return null;
  }

  if (normalized.length <= maxChars) {
    return normalized;
  }

  return `${normalized.slice(0, maxChars - 1)}...`;
}

export function laneEventStarted(emittedAt) {
  return {
    event: "lane.started",
    status: "running",
    emittedAt,
    failureClass: null,
    detail: null,
    data: null,
  };
}

export function laneEventFinished(emittedAt, detail = null) {
  return {
    event: "lane.finished",
    status: "completed",
    emittedAt,
    failureClass: null,
    detail: compressSummaryText(detail),
    data: null,
  };
}

export function laneEventClosed(emittedAt, detail = null) {
  return {
    event: "lane.closed",
    status: "closed",
    emittedAt,
    failureClass: null,
    detail: compressSummaryText(detail),
    data: null,
  };
}

export function laneEventBlocked(emittedAt, blocker) {
  return {
    event: "lane.blocked",
    status: "blocked",
    emittedAt,
    failureClass: blocker?.failureClass ?? null,
    detail: normalizeDetail(blocker?.detail),
    data: null,
  };
}

export function laneEventFailed(emittedAt, blocker) {
  return {
    event: "lane.failed",
    status: "failed",
    emittedAt,
    failureClass: blocker?.failureClass ?? null,
    detail: normalizeDetail(blocker?.detail),
    data: null,
  };
}

export function classifyLaneBlocker(error) {
  const detail = normalizeDetail(error);
  if (!detail) {
    return null;
  }

  const lower = detail.toLowerCase();
  if (lower.includes("unknown tool") || lower.includes("tool failed") || lower.includes("pre_tool_use")) {
    return { failureClass: "tool_runtime", detail };
  }
  if (lower.includes("test")) {
    return { failureClass: "test", detail };
  }
  if (lower.includes("compile")) {
    return { failureClass: "compile", detail };
  }
  if (lower.includes("merge conflict") || lower.includes("branch")) {
    return { failureClass: "branch_divergence", detail };
  }

  return { failureClass: "infra", detail };
}

export function deriveAgentState(status, result = null, error = null, blocker = null) {
  const normalizedStatus = String(status ?? "").trim().toLowerCase();
  const normalizedError = String(error ?? "").toLowerCase();

  if (normalizedStatus === "running") {
    return "working";
  }

  if (normalizedStatus === "completed") {
    return normalizeDetail(result) ? "finished_cleanable" : "finished_pending_report";
  }

  if (normalizedError.includes("background")) {
    return "blocked_background_job";
  }

  if (normalizedStatus === "stopped" || normalizedStatus === "failed" || blocker) {
    return "truly_idle";
  }

  return "truly_idle";
}
