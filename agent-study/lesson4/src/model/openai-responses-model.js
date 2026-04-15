import { countConversationTurns, normalizeSessionMessage } from "../core/message-protocol.js";

function stringifyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function writeTrace(traceLogger, title, payload) {
  if (!traceLogger) {
    return;
  }

  traceLogger.write(title, payload);
}

function buildResponseSummary(payload) {
  const choice = payload.choices?.[0];
  const message = choice?.message;
  const toolCalls = message?.tool_calls ?? [];

  return {
    finish_reason: choice?.finish_reason ?? null,
    message_role: message?.role ?? null,
    has_content: Boolean(message?.content),
    content_preview: message?.content?.slice(0, 200) ?? "",
    has_reasoning_content: Boolean(message?.reasoning_content),
    reasoning_preview: message?.reasoning_content?.slice(0, 300) ?? "",
    tool_call_count: toolCalls.length,
    tool_calls: toolCalls.map((toolCall) => ({
      id: toolCall.id,
      name: toolCall.function?.name ?? null,
      arguments: toolCall.function?.arguments ?? "",
    })),
  };
}

function validateFinishReason(choice) {
  const finishReason = choice?.finish_reason ?? null;
  const message = choice?.message ?? {};
  const toolCalls = message.tool_calls ?? [];
  const hasToolCalls = toolCalls.length > 0;
  const hasContent = typeof message.content === "string" && message.content.trim().length > 0;
  const hasReasoningContent =
    typeof message.reasoning_content === "string" && message.reasoning_content.trim().length > 0;
  const warnings = [];

  if (finishReason === "tool_calls" && !hasToolCalls) {
    warnings.push("finish_reason is tool_calls, but message.tool_calls is empty.");
  }

  if (finishReason === "stop" && hasToolCalls) {
    warnings.push("finish_reason is stop, but message.tool_calls is present.");
  }

  if (!finishReason) {
    warnings.push("finish_reason is missing.");
  }

  if (hasToolCalls && hasContent) {
    warnings.push("message contains both tool_calls and assistant text content.");
  }

  if (hasReasoningContent && !hasToolCalls && !hasContent) {
    warnings.push("message has reasoning_content, but no tool_calls and no visible content.");
  }

  return warnings;
}

function normalizeToolSchema(schema) {
  return schema ?? {
    type: "object",
    properties: {},
  };
}

function mapTools(tools) {
  return tools.map((tool) => ({
    type: "function",
    function: {
      name: tool.name,
      description: tool.description,
      parameters: normalizeToolSchema(tool.inputSchema),
    },
  }));
}

function mapNormalizedMessage(message) {
  if (message.role === "user" && message.kind === "text") {
    return {
      role: "user",
      content: message.text,
    };
  }

  if (message.role === "assistant" && message.kind === "text") {
    return {
      role: "assistant",
      content: message.text,
    };
  }

  if (message.role === "assistant" && message.kind === "final_answer") {
    return {
      role: "assistant",
      content: message.text,
    };
  }

  if (message.role === "assistant" && message.kind === "tool_request" && message.toolCallId) {
    return {
      role: "assistant",
      content: "",
      tool_calls: [
        {
          id: message.toolCallId,
          type: "function",
          function: {
            name: message.toolName,
            arguments: stringifyJson(message.input),
          },
        },
      ],
    };
  }

  if (message.role === "tool" && message.kind === "tool_result" && message.toolCallId) {
    return {
      role: "tool",
      tool_call_id: message.toolCallId,
      content: stringifyJson(
        message.ok
          ? {
              ok: true,
              result: message.content,
            }
          : {
              ok: false,
              error: message.error,
            },
      ),
    };
  }

  return null;
}

function mapMessages(messages, systemPrompt) {
  const mapped = [
    {
      role: "system",
      content: systemPrompt,
    },
  ];

  for (const message of messages) {
    const result = mapNormalizedMessage(normalizeSessionMessage(message));

    if (result) {
      mapped.push(result);
    }
  }

  return mapped;
}

export class OpenAIResponsesModel {
  constructor({ apiKey, model, baseUrl, trace = false, traceLogger = null }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.trace = trace;
    this.traceLogger = traceLogger;
  }

  async decide({ systemPrompt, messages, tools, iteration }) {
    const requestBody = {
      model: this.model,
      messages: mapMessages(messages, systemPrompt),
      tools: mapTools(tools),
      tool_choice: "auto",
    };

    if (this.trace) {
      writeTrace(this.traceLogger, `LLM REQUEST ITERATION ${iteration}`, {
        url: `${this.baseUrl}/chat/completions`,
        method: "POST",
        headers: {
          Authorization: "Bearer ***redacted***",
          "Content-Type": "application/json",
        },
        body: requestBody,
        debug: {
          sourceMessageCount: messages.length,
          mappedMessageCount: requestBody.messages.length,
          conversationTurns: countConversationTurns(messages),
        },
      });
    }

    const response = await fetch(`${this.baseUrl}/chat/completions`, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${this.apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(requestBody),
    });

    if (!response.ok) {
      const errorText = await response.text();
      if (this.trace) {
        writeTrace(this.traceLogger, `LLM RESPONSE ITERATION ${iteration}`, {
          ok: false,
          status: response.status,
          body: errorText,
        });
      }
      throw new Error(`OpenAI-compatible chat API error (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const choice = payload.choices?.[0];
    const finishReasonWarnings = validateFinishReason(choice);

    if (this.trace) {
      writeTrace(this.traceLogger, `LLM RESPONSE ITERATION ${iteration}`, payload);
      writeTrace(this.traceLogger, `LLM RESPONSE SUMMARY ITERATION ${iteration}`, {
        ...buildResponseSummary(payload),
        warnings: finishReasonWarnings,
      });
    }
    const message = choice?.message;
    const toolCalls = (message?.tool_calls ?? [])
      .filter((toolCall) => toolCall?.function?.name)
      .map((toolCall) => ({
        toolName: toolCall.function.name,
        input: JSON.parse(toolCall.function.arguments || "{}"),
        toolCallId: toolCall.id,
      }));

    if (toolCalls.length > 0) {
      return {
        type: "tools",
        toolCalls,
        finishReason: choice?.finish_reason ?? null,
        warnings: finishReasonWarnings,
      };
    }

    return {
      type: "final",
      finishReason: choice?.finish_reason ?? null,
      warnings: finishReasonWarnings,
      output:
        message?.content?.trim() ||
        "模型返回了响应，但没有可提取的文本输出。你可以打印原始 payload 来继续调试。",
    };
  }
}
