function canonicalToken(value) {
  return String(value ?? "")
    .split("")
    .filter((character) => /[A-Za-z0-9]/.test(character))
    .join("")
    .toLowerCase();
}

const SUBAGENT_TYPES = {
  "general-purpose": {
    name: "general-purpose",
    aliases: ["general", "generalpurpose", "generalpurposeagent"],
    description: "General implementation subagent for bounded execution work.",
    instructions: [
      "You are the implementation-oriented delegate for this task.",
      "Make progress with the tools you have, but stay within the delegated scope.",
      "Prefer concrete outputs over open-ended discussion.",
    ],
    allowedTools: [
      "bash",
      "read_file",
      "write_file",
      "edit_file",
      "glob_search",
      "grep_search",
      "grep_text",
      "list_files",
      "WebFetch",
      "WebSearch",
      "Skill",
      "ToolSearch",
    ],
  },
  Explore: {
    name: "Explore",
    aliases: ["explore", "explorer", "exploreagent"],
    description: "Read-only exploration subagent for gathering facts and summarizing findings.",
    instructions: [
      "You are the exploration delegate for this task.",
      "Gather evidence first, summarize what you learn, and do not mutate files.",
      "Prefer narrower reads and searches over broad dumps.",
    ],
    allowedTools: [
      "read_file",
      "glob_search",
      "grep_search",
      "grep_text",
      "list_files",
      "WebFetch",
      "WebSearch",
      "Skill",
      "ToolSearch",
    ],
  },
  Plan: {
    name: "Plan",
    aliases: ["plan", "planagent"],
    description: "Planning subagent for task breakdown, sequencing, and risk framing.",
    instructions: [
      "You are the planning delegate for this task.",
      "Turn gathered facts into a concrete plan, assumptions, and risk notes.",
      "Stay read-only and return a structured plan the main agent can execute.",
    ],
    allowedTools: [
      "read_file",
      "glob_search",
      "grep_search",
      "grep_text",
      "list_files",
      "WebFetch",
      "WebSearch",
      "TodoWrite",
      "StructuredOutput",
      "Skill",
      "ToolSearch",
    ],
  },
  Verification: {
    name: "Verification",
    aliases: ["verification", "verificationagent", "verify", "verifier"],
    description: "Verification subagent for checks, tests, and validation.",
    instructions: [
      "You are the verification delegate for this task.",
      "Check results, run validations when helpful, and report pass/fail clearly.",
      "Do not mutate files; verification should describe what passed and what did not.",
    ],
    allowedTools: [
      "bash",
      "read_file",
      "glob_search",
      "grep_search",
      "grep_text",
      "list_files",
      "WebFetch",
      "WebSearch",
      "ToolSearch",
    ],
  },
};

const DEFAULT_SUBAGENT_TYPE = "general-purpose";

export function normalizeSubagentType(subagentType) {
  const trimmed = String(subagentType ?? "").trim();
  if (!trimmed) {
    return DEFAULT_SUBAGENT_TYPE;
  }

  const canonical = canonicalToken(trimmed);
  for (const spec of Object.values(SUBAGENT_TYPES)) {
    if (canonicalToken(spec.name) === canonical) {
      return spec.name;
    }

    if (spec.aliases.some((alias) => canonicalToken(alias) === canonical)) {
      return spec.name;
    }
  }

  return trimmed;
}

export function subagentTypeSpec(subagentType) {
  const normalized = normalizeSubagentType(subagentType);
  return SUBAGENT_TYPES[normalized] ?? SUBAGENT_TYPES[DEFAULT_SUBAGENT_TYPE];
}

export function allowedToolsForSubagent(subagentType) {
  return new Set(subagentTypeSpec(subagentType).allowedTools);
}

export function buildSubagentSystemPrompt(subagentType) {
  const spec = subagentTypeSpec(subagentType);
  return [
    "You are a background sub-agent.",
    `Your subagent type is \`${spec.name}\`.`,
    spec.description,
    ...spec.instructions,
    "Work only on the delegated task.",
    "Use only the tools available to you.",
    "Do not ask the user questions.",
    "Finish with a concise result that the main agent can reuse.",
  ].join("\n");
}

export function listSupportedSubagentTypes() {
  return Object.values(SUBAGENT_TYPES).map((spec) => ({
    name: spec.name,
    description: spec.description,
    allowedTools: [...spec.allowedTools],
  }));
}
