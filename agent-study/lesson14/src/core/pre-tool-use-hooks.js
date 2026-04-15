export function runPreToolUseHooks({
  toolCall,
  descriptor,
  activeGuardrails = [],
  hooks = [],
  workspaceRoot = null,
}) {
  for (const hook of hooks) {
    const outcome = hook({
      toolCall,
      descriptor,
      activeGuardrails,
      workspaceRoot,
    });
    if (outcome) {
      return outcome;
    }
  }

  return null;
}

export function buildPreToolUseBlockResult(toolCall, outcome) {
  const guardrail = outcome?.guardrail ?? null;
  return {
    blocked: true,
    reason: "pre_tool_use_blocked",
    hook: {
      name: outcome?.hookName ?? "pre_tool_use_hook",
      decision: outcome?.decision ?? "block",
    },
    guardrail: {
      kind: guardrail?.kind ?? "pre_tool_use_blocked",
      sourceIteration: guardrail?.sourceIteration ?? null,
      sourceToolName: guardrail?.sourceToolName ?? null,
      sourceToolFamily: guardrail?.sourceToolFamily ?? null,
    },
    summary:
      outcome?.summary ??
      "A deterministic pre-tool-use hook blocked this follow-up because it matched a known high-cost boundary.",
    input: toolCall.input ?? null,
    toolName: toolCall.toolName,
  };
}
