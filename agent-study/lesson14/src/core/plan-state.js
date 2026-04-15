function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function normalizeStringList(values) {
  const seen = new Set();
  const items = [];

  for (const value of values ?? []) {
    const normalized = normalizeLine(value);
    if (!normalized) {
      continue;
    }

    const key = normalized.toLowerCase();
    if (seen.has(key)) {
      continue;
    }

    seen.add(key);
    items.push(normalized);
  }

  return items;
}

function normalizeTodoList(values) {
  const todos = [];

  for (const value of values ?? []) {
    if (!value || typeof value !== "object" || Array.isArray(value)) {
      continue;
    }

    const content = normalizeLine(value.content);
    const activeForm = normalizeLine(value.activeForm);
    const status = normalizeLine(value.status);
    if (!content || !activeForm || !status) {
      continue;
    }

    todos.push({
      content,
      activeForm,
      status,
    });
  }

  return todos;
}

function listFromStructuredPayload(payload, ...keys) {
  for (const key of keys) {
    const value = payload?.[key];
    if (Array.isArray(value)) {
      return normalizeStringList(value);
    }
  }

  return [];
}

export function normalizePlanState(planState) {
  if (!planState || typeof planState !== "object") {
    return null;
  }

  const objective = normalizeLine(planState.objective);
  if (!objective) {
    return null;
  }

  const summary = normalizeLine(planState.summary);
  return {
    objective,
    summary: summary || "",
    sourceAgentId: normalizeLine(planState.sourceAgentId) || null,
    sourceSubagentType: normalizeLine(planState.sourceSubagentType) || "Plan",
    updatedAt: normalizeLine(planState.updatedAt) || new Date().toISOString(),
    targets: normalizeStringList(planState.targets),
    steps: normalizeStringList(planState.steps),
    risks: normalizeStringList(planState.risks),
    doneWhen: normalizeStringList(planState.doneWhen),
    outOfScope: normalizeStringList(planState.outOfScope),
    todos: normalizeTodoList(planState.todos),
  };
}

export function planStateFromSubagentResult(subagentResult, taskPacket = null) {
  if (!subagentResult || typeof subagentResult !== "object") {
    return null;
  }

  if (String(subagentResult.subagentType ?? "") !== "Plan") {
    return null;
  }

  const structured = subagentResult.structuredResult ?? {};
  const objective =
    normalizeLine(structured.objective) ||
    normalizeLine(subagentResult.description) ||
    normalizeLine(taskPacket?.objective);

  if (!objective) {
    return null;
  }

  return normalizePlanState({
    objective,
    summary: normalizeLine(subagentResult.result),
    sourceAgentId: subagentResult.agentId ?? null,
    sourceSubagentType: subagentResult.subagentType ?? "Plan",
    updatedAt: subagentResult.completedAt ?? new Date().toISOString(),
    targets: listFromStructuredPayload(structured, "targets", "scope_targets"),
    steps: listFromStructuredPayload(structured, "plan", "steps", "next_actions"),
    risks: listFromStructuredPayload(structured, "risks", "risk_notes"),
    doneWhen: listFromStructuredPayload(
      structured,
      "done_when",
      "doneWhen",
      "acceptance",
      "acceptance_tests",
    ),
    outOfScope: listFromStructuredPayload(structured, "out_of_scope", "outOfScope"),
    todos: subagentResult.latestTodoState?.newTodos ?? [],
  });
}

export function renderPlanPinMessage(planState) {
  const normalized = normalizePlanState(planState);
  if (!normalized) {
    return "";
  }

  const lines = [
    "# Plan Pin",
    `- Objective: ${normalized.objective}`,
  ];

  if (normalized.summary) {
    lines.push(`- Latest Plan Summary: ${normalized.summary}`);
  }

  if (normalized.targets.length > 0) {
    lines.push("- Targets:");
    lines.push(...normalized.targets.map((item) => `  - ${item}`));
  }

  if (normalized.steps.length > 0) {
    lines.push("- Planned Steps:");
    lines.push(...normalized.steps.map((item) => `  - ${item}`));
  }

  if (normalized.risks.length > 0) {
    lines.push("- Risks:");
    lines.push(...normalized.risks.map((item) => `  - ${item}`));
  }

  if (normalized.doneWhen.length > 0) {
    lines.push("- Done When:");
    lines.push(...normalized.doneWhen.map((item) => `  - ${item}`));
  }

  if (normalized.outOfScope.length > 0) {
    lines.push("- Out Of Scope:");
    lines.push(...normalized.outOfScope.map((item) => `  - ${item}`));
  }

  if (normalized.todos.length > 0) {
    lines.push("- Current Todos:");
    lines.push(
      ...normalized.todos.map((todo) => `  - [${todo.status}] ${todo.content} (${todo.activeForm})`),
    );
  }

  lines.push("- Follow this plan unless newer evidence or the user explicitly changes the task.");
  return lines.join("\n");
}
