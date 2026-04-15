import { countConversationTurns, normalizeSessionMessage } from "../core/message-protocol.js";
import { preflightTokenBudget } from "./model-token-limits.js";

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
  return messages.map((message) => mapNormalizedMessage(normalizeSessionMessage(message))).filter(Boolean);
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

  return {
    stop_reason: payload.stop_reason ?? null,
    has_text: textBlocks.length > 0,
    text_preview: textBlocks.map((block) => block.text).join("\n").slice(0, 200),
    tool_use_count: toolUses.length,
    tool_uses: toolUses.map((block) => ({
      id: block.id,
      name: block.name,
      input: block.input,
    })),
  };
}

export class AnthropicMessagesModel {
  constructor({
    apiKey,
    model,
    baseUrl,
    maxOutputTokens,
    trace = false,
    traceLogger = null,
    anthropicVersion = "2023-06-01",
  }) {
    this.apiKey = apiKey;
    this.model = model;
    this.baseUrl = baseUrl.replace(/\/$/, "");
    this.maxOutputTokens = maxOutputTokens;
    this.trace = trace;
    this.traceLogger = traceLogger;
    this.anthropicVersion = anthropicVersion;
  }

  async decide({ systemPrompt, messages, tools, iteration }) {
    const requestUrl = buildMessagesUrl(this.baseUrl);
    const systemMessages = collectSystemMessages(messages);
    const requestBody = {
      model: this.model,
      system: buildSystemPrompt(systemPrompt, systemMessages),
      max_tokens: this.maxOutputTokens,
      messages: mapMessages(messages),
      tools: mapTools(tools),
    };
    const preflight = preflightTokenBudget({
      model: this.model,
      requestPayload: {
        system: requestBody.system,
        messages: requestBody.messages,
        tools: requestBody.tools,
      },
      maxOutputTokens: this.maxOutputTokens,
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

    const response = await fetch(requestUrl, {
      method: "POST",
      headers: {
        "x-api-key": this.apiKey,
        Authorization: `Bearer ${this.apiKey}`,
        "anthropic-version": this.anthropicVersion,
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
      throw new Error(`Anthropic Messages API error (${response.status}): ${errorText}`);
    }

    const payload = await response.json();
    const summary = summarizeResponse(payload);

    if (this.trace) {
      writeTrace(this.traceLogger, `LLM RESPONSE ITERATION ${iteration}`, payload);
      writeTrace(this.traceLogger, `LLM RESPONSE SUMMARY ITERATION ${iteration}`, summary);
    }

    const toolUses = (payload.content ?? []).filter((block) => block.type === "tool_use");
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
      };
    }

    const output = (payload.content ?? [])
      .filter((block) => block.type === "text")
      .map((block) => block.text)
      .join("\n")
      .trim();

    return {
      type: "final",
      finishReason: payload.stop_reason ?? null,
      warnings: [],
      output: output || "Claude 返回了响应，但没有可提取的文本输出。",
    };
  }
}
