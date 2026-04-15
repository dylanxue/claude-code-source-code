function normalizeLine(value) {
  return String(value ?? "").replace(/\s+/g, " ").trim();
}

function dedupeStrings(values) {
  const seen = new Set();
  const results = [];

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
    results.push(normalized);
  }

  return results;
}

function firstArray(taskPacket, keys) {
  for (const key of keys) {
    if (Array.isArray(taskPacket?.[key])) {
      return taskPacket[key];
    }
  }

  return [];
}

function firstString(taskPacket, keys) {
  for (const key of keys) {
    const normalized = normalizeLine(taskPacket?.[key]);
    if (normalized) {
      return normalized;
    }
  }

  return "";
}

function collectLessonNumbers(prompt) {
  const text = String(prompt ?? "");
  const values = [];

  for (const match of text.matchAll(/lesson\s*(\d+)\s*(?:到|至|-|~|through|to)\s*(?:lesson\s*)?(\d+)/gi)) {
    const start = Number.parseInt(match[1], 10);
    const end = Number.parseInt(match[2], 10);
    if (!Number.isFinite(start) || !Number.isFinite(end)) {
      continue;
    }

    const lower = Math.min(start, end);
    const upper = Math.max(start, end);
    for (let current = lower; current <= upper; current += 1) {
      values.push(current);
    }
  }

  for (const match of text.matchAll(/lesson\s*(\d+)/gi)) {
    const value = Number.parseInt(match[1], 10);
    if (Number.isFinite(value)) {
      values.push(value);
    }
  }

  return values;
}

function formatLessonScope(lessonNumbers) {
  const unique = [...new Set(lessonNumbers)].sort((left, right) => left - right);
  if (unique.length === 0) {
    return null;
  }

  if (unique.length === 1) {
    return `Only analyze lesson${unique[0]}.`;
  }

  const contiguous = unique.every((value, index) => index === 0 || value === unique[index - 1] + 1);
  if (contiguous) {
    return `Only analyze lesson${unique[0]} through lesson${unique.at(-1)}.`;
  }

  return `Only analyze ${unique.map((value) => `lesson${value}`).join(", ")}.`;
}

function buildAcceptance(prompt, lessonNumbers) {
  const acceptance = ["Return a concise synthesized answer for the current user request."];

  if (lessonNumbers.length > 0) {
    acceptance.unshift("Cover every lesson within the requested lesson scope.");
  }

  if (/(判断|匹配|一致|对比|compare|match|consistent|verify)/i.test(prompt)) {
    acceptance.push("Judge whether the documented functionality matches the implementation within scope.");
  }

  return dedupeStrings(acceptance);
}

function buildOutOfScope(prompt, lessonNumbers) {
  const outOfScope = [];
  const unique = [...new Set(lessonNumbers)].sort((left, right) => left - right);

  if (unique.length > 0) {
    const maxLesson = unique.at(-1);
    outOfScope.push(`Do not expand to lesson${maxLesson + 1} or later unless the user explicitly asks.`);
  }

  if (/(匹配|一致|compare|match|verify)/i.test(prompt)) {
    outOfScope.push("Do not drift into broader course review if the requested comparison can already be completed.");
  }

  return dedupeStrings(outOfScope);
}

export function normalizeTaskPacket(taskPacket) {
  if (!taskPacket || typeof taskPacket !== "object") {
    return null;
  }

  const objective = firstString(taskPacket, ["objective"]);
  if (!objective) {
    return null;
  }

  const scope = firstString(taskPacket, ["scope"]);
  const acceptance = dedupeStrings(
    firstArray(taskPacket, ["acceptanceTests", "acceptance_tests", "acceptance"]),
  );
  const outOfScope = dedupeStrings(firstArray(taskPacket, ["outOfScope", "out_of_scope"]));

  return {
    objective,
    scope: scope || "Stay tightly scoped to the current user request.",
    repo: firstString(taskPacket, ["repo"]) || null,
    branchPolicy: firstString(taskPacket, ["branchPolicy", "branch_policy"]) || null,
    acceptanceTests: acceptance,
    acceptance,
    commitPolicy: firstString(taskPacket, ["commitPolicy", "commit_policy"]) || null,
    reportingContract: firstString(taskPacket, ["reportingContract", "reporting_contract"]) || null,
    escalationPolicy: firstString(taskPacket, ["escalationPolicy", "escalation_policy"]) || null,
    outOfScope,
  };
}

export function validateStructuredTaskPacket(taskPacket) {
  const errors = [];
  const packet = normalizeTaskPacket(taskPacket);
  const acceptanceTests = firstArray(taskPacket, ["acceptanceTests", "acceptance_tests", "acceptance"]);

  if (!packet?.objective) {
    errors.push("objective must not be empty");
  }

  if (!packet?.scope) {
    errors.push("scope must not be empty");
  }

  if (!packet?.repo) {
    errors.push("repo must not be empty");
  }

  if (!packet?.branchPolicy) {
    errors.push("branch_policy must not be empty");
  }

  if (!packet?.commitPolicy) {
    errors.push("commit_policy must not be empty");
  }

  if (!packet?.reportingContract) {
    errors.push("reporting_contract must not be empty");
  }

  if (!packet?.escalationPolicy) {
    errors.push("escalation_policy must not be empty");
  }

  if (!Array.isArray(acceptanceTests)) {
    errors.push("acceptance_tests must be an array");
  } else {
    for (const [index, value] of acceptanceTests.entries()) {
      if (!normalizeLine(value)) {
        errors.push(`acceptance_tests contains an empty value at index ${index}`);
      }
    }
  }

  return { packet, errors };
}

export function inferTaskPacketFromPrompt(prompt) {
  const objective = normalizeLine(prompt);
  if (!objective) {
    return null;
  }

  const lessonNumbers = collectLessonNumbers(prompt);
  return normalizeTaskPacket({
    objective,
    scope: formatLessonScope(lessonNumbers) ?? "Stay tightly scoped to the current user request.",
    acceptance: buildAcceptance(prompt, lessonNumbers),
    outOfScope: buildOutOfScope(prompt, lessonNumbers),
  });
}

export function renderTaskPinMessage(taskPacket) {
  const normalized = normalizeTaskPacket(taskPacket);
  if (!normalized) {
    return "";
  }

  const lines = [
    "# Task Pin",
    `- Objective: ${normalized.objective}`,
    `- Scope: ${normalized.scope}`,
  ];

  if (normalized.repo) {
    lines.push(`- Repo: ${normalized.repo}`);
  }

  if (normalized.branchPolicy) {
    lines.push(`- Branch Policy: ${normalized.branchPolicy}`);
  }

  if (normalized.acceptanceTests.length > 0) {
    lines.push("- Acceptance:");
    lines.push(...normalized.acceptanceTests.map((item) => `  - ${item}`));
  }

  if (normalized.commitPolicy) {
    lines.push(`- Commit Policy: ${normalized.commitPolicy}`);
  }

  if (normalized.reportingContract) {
    lines.push(`- Reporting Contract: ${normalized.reportingContract}`);
  }

  if (normalized.escalationPolicy) {
    lines.push(`- Escalation Policy: ${normalized.escalationPolicy}`);
  }

  if (normalized.outOfScope.length > 0) {
    lines.push("- Out Of Scope:");
    lines.push(...normalized.outOfScope.map((item) => `  - ${item}`));
  }

  lines.push("- Stay within this pinned task unless the user explicitly changes it.");
  return lines.join("\n");
}
