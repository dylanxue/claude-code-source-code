import { countConversationTurns, normalizeSessionMessage } from "../core/message-protocol.js";
import { preflightTokenBudget } from "./model-token-limits.js";
import { collectSseEvents } from "./streaming-sse.js";

function stringifyJson(value) {
  return JSON.stringify(value ?? {}, null, 2);
}

function writeTrace(traceLogger, title, payload) {
  if (!traceLogger) {
    return;
  }

  traceLogger.write(title, payload);
}

function emitAssistantEvent(onAssistantEvent, event) {
  onAssistantEvent?.(event);
}

function normalizeSnapshotText(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
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

function summarizeStreamEvent(event) {
  const choice = event.payload?.choices?.[0];
  const delta = choice?.delta ?? {};
  return {
    event: event.event,
    finish_reason: choice?.finish_reason ?? null,
    has_usage: Boolean(event.payload?.usage),
    content_preview:
      typeof delta.content === "string"
        ? delta.content.slice(0, 120)
        : Array.isArray(delta.content)
          ? JSON.stringify(delta.content).slice(0, 120)
          : "",
    reasoning_preview:
      typeof delta.reasoning_content === "string" ? delta.reasoning_content.slice(0, 120) : "",
    tool_calls: (delta.tool_calls ?? []).map((toolCall) => ({
      index: toolCall.index ?? null,
      id: toolCall.id ?? null,
      name: toolCall.function?.name ?? null,
      arguments_preview: toolCall.function?.arguments?.slice(0, 120) ?? "",
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

function safeParseToolArguments(argumentsText) {
  if (!argumentsText || !argumentsText.trim()) {
    return {};
  }

  try {
    return JSON.parse(argumentsText);
  } catch {
    return {
      _raw: argumentsText,
    };
  }
}

function buildStreamingPayload(events, { onAssistantEvent = null } = {}) {
  let role = "assistant";
  let content = "";
  let reasoningContent = "";
  let finishReason = null;
  let usage = null;
  const streamedToolCalls = new Map();

  for (const event of events) {
    const payload = event.payload;
    if (!payload) {
      continue;
    }

    if (payload.usage) {
      usage = payload.usage;
    }

    for (const choice of payload.choices ?? []) {
      const delta = choice.delta ?? {};
      if (delta.role) {
        role = delta.role;
      }

      if (typeof delta.content === "string" && delta.content.length > 0) {
        content += delta.content;
        emitAssistantEvent(onAssistantEvent, {
          type: "text_delta",
          text: delta.content,
        });
      }

      if (
        typeof delta.reasoning_content === "string" &&
        delta.reasoning_content.length > 0
      ) {
        reasoningContent += delta.reasoning_content;
        emitAssistantEvent(onAssistantEvent, {
          type: "reasoning_delta",
          text: delta.reasoning_content,
        });
      }

      for (const toolCallDelta of delta.tool_calls ?? []) {
        const index = Number(toolCallDelta.index ?? 0);
        const existing = streamedToolCalls.get(index) ?? {
          id: null,
          type: "function",
          function: {
            name: "",
            arguments: "",
          },
        };

        if (toolCallDelta.id) {
          existing.id = toolCallDelta.id;
        }
        if (toolCallDelta.type) {
          existing.type = toolCallDelta.type;
        }
        if (toolCallDelta.function?.name) {
          existing.function.name += toolCallDelta.function.name;
        }
        if (toolCallDelta.function?.arguments) {
          existing.function.arguments += toolCallDelta.function.arguments;
        }

        streamedToolCalls.set(index, existing);
      }

      if (choice.finish_reason) {
        finishReason = choice.finish_reason;
      }
    }
  }

  const toolCalls = [...streamedToolCalls.entries()]
    .sort((a, b) => a[0] - b[0])
    .map(([, toolCall]) => toolCall)
    .filter((toolCall) => toolCall.function?.name);

  for (const toolCall of toolCalls) {
    emitAssistantEvent(onAssistantEvent, {
      type: "tool_use",
      id: toolCall.id,
      name: toolCall.function.name,
      input: safeParseToolArguments(toolCall.function.arguments),
    });
  }

  emitAssistantEvent(onAssistantEvent, {
    type: "message_stop",
    stopReason: finishReason,
  });

  return {
    id: null,
    object: "chat.completion",
    created: null,
    model: null,
    choices: [
      {
        index: 0,
        finish_reason: finishReason,
        message: {
          role,
          content,
          reasoning_content: reasoningContent,
          tool_calls: toolCalls,
        },
      },
    ],
    usage,
    streamed_text: content,
    streamed_reasoning: reasoningContent,
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
  if (message.role === "system" && message.kind === "text") {
    return {
      role: "system",
      content: message.text,
    };
  }

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
  const mapped = [];
  let hasInjectedSystemPrompt = false;

  for (const message of messages) {
    const result = mapNormalizedMessage(normalizeSessionMessage(message));

    if (result) {
      if (result.role !== "system" && !hasInjectedSystemPrompt) {
        mapped.push({
          role: "system",
          content: systemPrompt,
        });
        hasInjectedSystemPrompt = true;
      }
      mapped.push(result);
    }
  }

  if (!hasInjectedSystemPrompt) {
    mapped.unshift({
      role: "system",
      content: systemPrompt,
    });
  }

  return mapped;
}

export class OpenAIResponsesModel {
  constructor({
    apiKey,
    model,
    baseUrl,
    maxOutputTokens,
    requestTimeoutMs = 45000,
    stream = true,
    trace = false,
    traceLogger = null,
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxOutputTokens = maxOutputTokens;
    this.requestTimeoutMs = requestTimeoutMs;
    this.stream = stream;
    this.trace = trace;
    this.traceLogger = traceLogger;
  }

  previewBudget({ systemPrompt, messages, tools }) {
    const mappedTools = mapTools(tools);
    return preflightTokenBudget({
      model: this.model,
      requestPayload: {
        messages: mapMessages(messages, systemPrompt),
        tools: mappedTools,
      },
      maxOutputTokens: this.maxOutputTokens,
    });
  }

  async decide({ systemPrompt, messages, tools, iteration, onAssistantEvent = null }) {
    const mappedTools = mapTools(tools);
    const requestBody = {
      model: this.model,
      messages: mapMessages(messages, systemPrompt),
      max_tokens: this.maxOutputTokens,
      stream: this.stream,
      ...(this.stream
        ? {
            stream_options: {
              include_usage: true,
            },
          }
        : {}),
      ...(mappedTools.length > 0
        ? {
            tools: mappedTools,
            tool_choice: "auto",
          }
        : {}),
    };
    const preflight = this.previewBudget({
      systemPrompt,
      messages,
      tools,
    });

    if (preflight.exceeded) {
      throw new Error(
        `Estimated request exceeds model context window (${preflight.estimatedTotalTokens} > ${preflight.contextWindowTokens}).`,
      );
    }

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
          maxOutputTokens: this.maxOutputTokens,
          tokenBudget: preflight,
        },
      });
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    let response;
    try {
      response = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(requestBody),
        signal: abortController.signal,
      });
    } catch (error) {
      clearTimeout(timeoutId);
      if (error instanceof Error && error.name === "AbortError") {
        if (this.trace) {
          writeTrace(this.traceLogger, `LLM RESPONSE ITERATION ${iteration}`, {
            ok: false,
            error: "request_timeout",
            timeoutMs: this.requestTimeoutMs,
          });
        }
        throw new Error(
          `OpenAI-compatible chat API timed out after ${this.requestTimeoutMs}ms while waiting for response.`,
        );
      }
      throw error;
    }

    if (!response.ok) {
      clearTimeout(timeoutId);
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

    let payload;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (this.stream && response.body && contentType.includes("text/event-stream")) {
        const events = [];
        await collectSseEvents(response.body, (event) => {
          events.push(event);
          if (this.trace) {
            writeTrace(
              this.traceLogger,
              `LLM STREAM EVENT ITERATION ${iteration}`,
              summarizeStreamEvent(event),
            );
          }
        });
        payload = buildStreamingPayload(events, {
          onAssistantEvent,
        });
      } else {
        payload = await response.json();
      }
    } catch (error) {
      if (error instanceof Error && error.name === "AbortError") {
        if (this.trace) {
          writeTrace(this.traceLogger, `LLM RESPONSE ITERATION ${iteration}`, {
            ok: false,
            error: "request_timeout",
            timeoutMs: this.requestTimeoutMs,
          });
        }
        throw new Error(
          `OpenAI-compatible chat API timed out after ${this.requestTimeoutMs}ms while reading the response body.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
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
    const output = message?.content?.trim() ?? "";
    const reasoning = message?.reasoning_content?.trim() ?? "";
    const streamedText = payload.streamed_text ?? "";
    const streamedReasoning = payload.streamed_reasoning ?? "";
    const normalizedOutput = normalizeSnapshotText(output);
    const normalizedReasoning = normalizeSnapshotText(reasoning);
    const normalizedStreamedText = normalizeSnapshotText(streamedText);
    const normalizedStreamedReasoning = normalizeSnapshotText(streamedReasoning);

    if (normalizedOutput && normalizedOutput !== normalizedStreamedText) {
      emitAssistantEvent(onAssistantEvent, {
        type: "text_snapshot",
        text: output,
      });
    }
    if (normalizedReasoning && normalizedReasoning !== normalizedStreamedReasoning) {
      emitAssistantEvent(onAssistantEvent, {
        type: "reasoning_snapshot",
        text: reasoning,
      });
    }

    const toolCalls = (message?.tool_calls ?? [])
      .filter((toolCall) => toolCall?.function?.name)
      .map((toolCall) => ({
        toolName: toolCall.function.name,
        input: safeParseToolArguments(toolCall.function.arguments || "{}"),
        toolCallId: toolCall.id,
      }));

    if (toolCalls.length > 0) {
      return {
        type: "tools",
        toolCalls,
        finishReason: choice?.finish_reason ?? null,
        warnings: finishReasonWarnings,
        output,
        reasoning,
        usage: payload.usage ?? null,
        preflight,
      };
    }

    return {
      type: "final",
      finishReason: choice?.finish_reason ?? null,
      warnings: finishReasonWarnings,
      output: output || "模型返回了响应，但没有可提取的文本输出。你可以打印原始 payload 来继续调试。",
      reasoning,
      usage: payload.usage ?? null,
      preflight,
    };
  }
}
