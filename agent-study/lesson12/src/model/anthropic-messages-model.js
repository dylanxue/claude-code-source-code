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

function buildMessagesUrl(baseUrl) {
  const normalized = baseUrl.replace(/\/$/, "");
  return normalized.endsWith("/v1") ? `${normalized}/messages` : `${normalized}/v1/messages`;
}

function mapTools(tools) {
  return tools.map((tool) => ({
    name: tool.name,
    description: tool.description,
    input_schema: tool.inputSchema ?? {
      type: "object",
      properties: {},
    },
  }));
}

function mapNormalizedMessage(message) {
  if (message.role === "system" && message.kind === "text") {
    return null;
  }

  if (message.role === "user" && message.kind === "text") {
    return {
      role: "user",
      content: message.text,
    };
  }

  if (message.role === "assistant" && (message.kind === "text" || message.kind === "final_answer")) {
    return {
      role: "assistant",
      content: [
        {
          type: "text",
          text: message.text,
        },
      ],
    };
  }

  if (message.role === "assistant" && message.kind === "tool_request") {
    return {
      role: "assistant",
      content: [
        {
          type: "tool_use",
          id: message.toolCallId,
          name: message.toolName,
          input: message.input,
        },
      ],
    };
  }

  if (message.role === "tool" && message.kind === "tool_result") {
    return {
      role: "user",
      content: [
        {
          type: "tool_result",
          tool_use_id: message.toolCallId,
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
          is_error: !message.ok,
        },
      ],
    };
  }

  return null;
}

function mapMessages(messages) {
  const mappedMessages = messages
    .map((message) => mapNormalizedMessage(normalizeSessionMessage(message)))
    .filter(Boolean);

  const mergedMessages = [];
  for (const message of mappedMessages) {
    const previous = mergedMessages.at(-1);
    if (!previous || previous.role !== message.role) {
      mergedMessages.push(message);
      continue;
    }

    if (Array.isArray(previous.content) && Array.isArray(message.content)) {
      previous.content.push(...message.content);
      continue;
    }

    if (typeof previous.content === "string" && typeof message.content === "string") {
      previous.content = `${previous.content}\n\n${message.content}`;
      continue;
    }

    if (typeof previous.content === "string" && Array.isArray(message.content)) {
      previous.content = [
        {
          type: "text",
          text: previous.content,
        },
        ...message.content,
      ];
      continue;
    }

    if (Array.isArray(previous.content) && typeof message.content === "string") {
      previous.content.push({
        type: "text",
        text: message.content,
      });
      continue;
    }

    mergedMessages.push(message);
  }

  return mergedMessages;
}

function collectSystemMessages(messages) {
  return messages
    .map((message) => normalizeSessionMessage(message))
    .filter((message) => message.role === "system" && message.kind === "text")
    .map((message) => message.text.trim())
    .filter(Boolean);
}

function buildSystemPrompt(systemPrompt, systemMessages) {
  return [systemPrompt, ...systemMessages].filter(Boolean).join("\n\n");
}

function previewSystemMessages(systemMessages) {
  return systemMessages.map((message, index) => ({
    index,
    preview: message.slice(0, 240),
  }));
}

function summarizeResponse(payload) {
  const blocks = payload.content ?? [];
  const toolUses = blocks.filter((block) => block.type === "tool_use");
  const textBlocks = blocks.filter((block) => block.type === "text");
  const reasoningBlocks = blocks.filter(
    (block) => block.type === "thinking" || block.type === "redacted_thinking",
  );

  return {
    stop_reason: payload.stop_reason ?? null,
    has_text: textBlocks.length > 0,
    text_preview: textBlocks.map((block) => block.text).join("\n").slice(0, 200),
    has_reasoning: reasoningBlocks.length > 0,
    reasoning_preview: reasoningBlocks
      .map((block) => block.thinking ?? "[redacted thinking]")
      .join("\n")
      .slice(0, 200),
    tool_use_count: toolUses.length,
    tool_uses: toolUses.map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    })),
  };
}

function summarizeStreamEvent(event) {
  const payloadType = event.payload?.type ?? null;
  return {
    event: event.event,
    type: payloadType,
    preview:
      typeof event.payload?.delta?.text === "string"
        ? event.payload.delta.text.slice(0, 120)
        : typeof event.payload?.delta?.thinking === "string"
          ? event.payload.delta.thinking.slice(0, 120)
        : typeof event.payload?.content_block?.text === "string"
          ? event.payload.content_block.text.slice(0, 120)
          : typeof event.payload?.content_block?.thinking === "string"
            ? event.payload.content_block.thinking.slice(0, 120)
          : null,
  };
}

function emitAssistantEvent(onAssistantEvent, event) {
  onAssistantEvent?.(event);
}

function normalizeSnapshotText(text) {
  return String(text ?? "").replace(/\r\n/g, "\n").trim();
}

function buildStreamingResponse(events, { onTextDelta = null, onAssistantEvent = null } = {}) {
  const contentBlocks = [];
  const toolBlocks = new Map();
  let stopReason = null;
  let usage = null;
  let emittedText = "";
  let emittedReasoning = "";

  for (const event of events) {
    const payload = event.payload;
    if (!payload) {
      continue;
    }

    switch (payload.type) {
      case "message_start": {
        const blocks = payload.message?.content ?? [];
        for (const [index, block] of blocks.entries()) {
          if (block.type === "text") {
            contentBlocks[index] = {
              type: "text",
              text: block.text ?? "",
            };
            if (block.text) {
              emittedText += block.text;
              onTextDelta?.(block.text);
              emitAssistantEvent(onAssistantEvent, {
                type: "text_delta",
                text: block.text,
              });
            }
          }
          if (block.type === "thinking" || block.type === "redacted_thinking") {
            contentBlocks[index] =
              block.type === "thinking"
                ? {
                    type: "thinking",
                    thinking: block.thinking ?? "",
                    signature: block.signature ?? null,
                  }
                : {
                    type: "redacted_thinking",
                    data: block.data ?? null,
                  };
            if (block.type === "thinking" && block.thinking) {
              emittedReasoning += block.thinking;
              emitAssistantEvent(onAssistantEvent, {
                type: "reasoning_delta",
                text: block.thinking,
              });
            }
          }
          if (block.type === "tool_use") {
            toolBlocks.set(block.id, {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input ?? {},
              index,
            });
            emitAssistantEvent(onAssistantEvent, {
              type: "tool_use",
              id: block.id,
              name: block.name,
              input: block.input ?? {},
            });
          }
        }
        usage = payload.message?.usage ?? usage;
        break;
      }
      case "content_block_start": {
        const block = payload.content_block;
        if (block?.type === "text") {
          contentBlocks[payload.index] = {
            type: "text",
            text: block.text ?? "",
          };
          if (block.text) {
            emittedText += block.text;
            onTextDelta?.(block.text);
            emitAssistantEvent(onAssistantEvent, {
              type: "text_delta",
              text: block.text,
            });
          }
        }
        if (block?.type === "thinking" || block?.type === "redacted_thinking") {
          contentBlocks[payload.index] =
            block.type === "thinking"
              ? {
                  type: "thinking",
                  thinking: block.thinking ?? "",
                  signature: block.signature ?? null,
                }
              : {
                  type: "redacted_thinking",
                  data: block.data ?? null,
                };
          if (block.type === "thinking" && block.thinking) {
            emittedReasoning += block.thinking;
            emitAssistantEvent(onAssistantEvent, {
              type: "reasoning_delta",
              text: block.thinking,
            });
          }
        }
        if (block?.type === "tool_use") {
          contentBlocks[payload.index] = {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input ?? {},
          };
          toolBlocks.set(block.id, {
            type: "tool_use",
            id: block.id,
            name: block.name,
            input: block.input ?? {},
            inputJson: "",
            index: payload.index,
          });
        }
        break;
      }
      case "content_block_delta": {
        const delta = payload.delta ?? {};
        if (delta.type === "text_delta") {
          contentBlocks[payload.index] = contentBlocks[payload.index] ?? {
            type: "text",
            text: "",
          };
          contentBlocks[payload.index].text += delta.text ?? "";
          if (delta.text) {
            emittedText += delta.text;
            onTextDelta?.(delta.text);
            emitAssistantEvent(onAssistantEvent, {
              type: "text_delta",
              text: delta.text,
            });
          }
        }
        if (delta.type === "thinking_delta") {
          contentBlocks[payload.index] = contentBlocks[payload.index] ?? {
            type: "thinking",
            thinking: "",
            signature: null,
          };
          contentBlocks[payload.index].thinking += delta.thinking ?? "";
          if (delta.thinking) {
            emittedReasoning += delta.thinking;
            emitAssistantEvent(onAssistantEvent, {
              type: "reasoning_delta",
              text: delta.thinking,
            });
          }
        }
        if (delta.type === "input_json_delta") {
          const toolBlock = [...toolBlocks.values()].find((entry) => entry.index === payload.index);
          if (toolBlock) {
            toolBlock.inputJson = `${toolBlock.inputJson ?? ""}${delta.partial_json ?? ""}`;
          }
        }
        break;
      }
      case "content_block_stop": {
        const toolBlock = [...toolBlocks.values()].find((entry) => entry.index === payload.index);
        if (toolBlock?.inputJson) {
          try {
            toolBlock.input = JSON.parse(toolBlock.inputJson);
          } catch {
            toolBlock.input = {};
          }
          contentBlocks[payload.index] = {
            type: "tool_use",
            id: toolBlock.id,
            name: toolBlock.name,
            input: toolBlock.input ?? {},
          };
        }
        if (toolBlock) {
          emitAssistantEvent(onAssistantEvent, {
            type: "tool_use",
            id: toolBlock.id,
            name: toolBlock.name,
            input: toolBlock.input ?? {},
          });
        }
        break;
      }
      case "message_delta": {
        stopReason = payload.delta?.stop_reason ?? stopReason;
        usage = payload.usage ?? usage;
        break;
      }
      case "message_stop": {
        emitAssistantEvent(onAssistantEvent, {
          type: "message_stop",
          stopReason,
          usage: usage ?? {},
        });
        break;
      }
      default:
        break;
    }
  }

  return {
    id: "streamed-message",
    type: "message",
    role: "assistant",
    model: "stream",
    content: contentBlocks.filter(Boolean),
    stop_reason: stopReason,
    usage: usage ?? {},
    streamed_text: emittedText,
    streamed_reasoning: emittedReasoning,
  };
}

export class AnthropicMessagesModel {
  constructor({
    apiKey,
    model,
    baseUrl,
    maxOutputTokens,
    requestTimeoutMs = 45000,
    stream = true,
    trace = false,
    traceLogger = null,
    anthropicVersion = "2023-06-01",
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxOutputTokens = maxOutputTokens;
    this.requestTimeoutMs = requestTimeoutMs;
    this.stream = stream;
    this.trace = trace;
    this.traceLogger = traceLogger;
    this.anthropicVersion = anthropicVersion;
  }

  previewBudget({ systemPrompt, messages, tools }) {
    const systemMessages = collectSystemMessages(messages);
    return preflightTokenBudget({
      model: this.model,
      requestPayload: {
        system: buildSystemPrompt(systemPrompt, systemMessages),
        messages: mapMessages(messages),
        tools: mapTools(tools),
      },
      maxOutputTokens: this.maxOutputTokens,
    });
  }

  async decide({ systemPrompt, messages, tools, iteration, onAssistantEvent = null }) {
    const requestUrl = buildMessagesUrl(this.baseUrl);
    const systemMessages = collectSystemMessages(messages);
    const requestBody = {
      model: this.model,
      system: buildSystemPrompt(systemPrompt, systemMessages),
      max_tokens: this.maxOutputTokens,
      messages: mapMessages(messages),
      tools: mapTools(tools),
      stream: this.stream,
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
        url: requestUrl,
        method: "POST",
        headers: {
          "x-api-key": "***redacted***",
          Authorization: "Bearer ***redacted***",
          "anthropic-version": this.anthropicVersion,
          "Content-Type": "application/json",
        },
        body: requestBody,
        debug: {
          sourceMessageCount: messages.length,
          mappedMessageCount: requestBody.messages.length,
          conversationTurns: countConversationTurns(messages),
          mergedSystemMessageCount: systemMessages.length,
          mergedSystemMessages: previewSystemMessages(systemMessages),
          maxOutputTokens: this.maxOutputTokens,
          tokenBudget: preflight,
        },
      });
    }

    const abortController = new AbortController();
    const timeoutId = setTimeout(() => abortController.abort(), this.requestTimeoutMs);
    let response;

    try {
      response = await fetch(requestUrl, {
        method: "POST",
        headers: {
          "x-api-key": this.apiKey,
          Authorization: `Bearer ${this.apiKey}`,
          "anthropic-version": this.anthropicVersion,
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
          `Anthropic Messages API timed out after ${this.requestTimeoutMs}ms while waiting for response.`,
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
      throw new Error(`Anthropic Messages API error (${response.status}): ${errorText}`);
    }

    let payload;
    try {
      const contentType = response.headers.get("content-type") ?? "";
      if (this.stream && response.body && contentType.includes("text/event-stream")) {
        const events = [];
        await collectSseEvents(response.body, (event) => {
          events.push(event);
          if (this.trace) {
            writeTrace(this.traceLogger, `LLM STREAM EVENT ITERATION ${iteration}`, summarizeStreamEvent(event));
          }
        });
        payload = buildStreamingResponse(events, {
          onTextDelta: null,
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
          `Anthropic Messages API timed out after ${this.requestTimeoutMs}ms while reading the response stream.`,
        );
      }
      throw error;
    } finally {
      clearTimeout(timeoutId);
    }
    const summary = summarizeResponse(payload);

    if (this.trace) {
      writeTrace(this.traceLogger, `LLM RESPONSE ITERATION ${iteration}`, payload);
      writeTrace(this.traceLogger, `LLM RESPONSE SUMMARY ITERATION ${iteration}`, summary);
    }

    const toolUses = (payload.content ?? []).filter((block) => block.type === "tool_use");
    const output = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();
    const reasoning = (payload.content ?? [])
      .filter((block) => block.type === "thinking")
      .map((block) => block.thinking)
      .join("\n")
      .trim();
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

    if (toolUses.length > 0) {
      return {
        type: "tools",
        toolCalls: toolUses.map((toolUse) => ({
          toolName: toolUse.name,
          input: toolUse.input ?? {},
          toolCallId: toolUse.id,
        })),
        finishReason: payload.stop_reason ?? null,
        warnings: [],
        output,
        reasoning,
        usage: payload.usage ?? null,
        preflight,
      };
    }

    return {
      type: "final",
      finishReason: payload.stop_reason ?? null,
      warnings: [],
      output: output || "Claude 返回了响应，但没有可提取的文本输出。",
      reasoning,
      usage: payload.usage ?? null,
      preflight,
    };
  }
}
