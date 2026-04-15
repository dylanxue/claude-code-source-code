export function createContinuation({
  reason,
  summary,
  suggestedActions = [],
  suggestedTool = null,
  strategy = null,
}) {
  return {
    reason,
    summary,
    strategy,
    suggestedTool,
    suggestedActions,
  };
}
