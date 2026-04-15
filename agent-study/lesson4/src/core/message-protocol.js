export function normalizeSessionMessage(message) {
  if (message.role === "user" && typeof message.content === "string") {
    return {
      role: "user",
      kind: "text",
      text: message.content,
    };
  }

  if (message.role === "assistant" && typeof message.content === "string") {
    return {
      role: "assistant",
      kind: "text",
      text: message.content,
    };
  }

  if (message.role === "assistant" && message.content?.type === "final_answer") {
    return {
      role: "assistant",
      kind: "final_answer",
      text: message.content.output,
      finishReason: message.content.finishReason ?? null,
      warnings: message.content.warnings ?? [],
    };
  }

  if (message.role === "assistant" && message.content?.type === "tool_request" && message.content.toolCallId) {
    return {
      role: "assistant",
      kind: "tool_request",
      toolName: message.content.toolName,
      input: message.content.input,
      toolCallId: message.content.toolCallId,
      finishReason: message.content.finishReason ?? null,
      warnings: message.content.warnings ?? [],
    };
  }

  if (message.role === "tool" && message.content?.toolCallId) {
    return {
      role: "tool",
      kind: "tool_result",
      toolName: message.content.toolName,
      toolCallId: message.content.toolCallId,
      ok: message.content.ok,
      input: message.content.input,
      content: message.content.content,
      error: message.content.error,
    };
  }

  return {
    role: message.role,
    kind: "unknown",
    raw: message.content,
  };
}

export function countConversationTurns(messages) {
  return messages.filter((message) => normalizeSessionMessage(message).role === "user").length;
}
