import { AnthropicMessagesModel } from "./anthropic-messages-model.js";
import { configuredMaxOutputTokens, maxOutputTokensForModelWithOverride } from "./model-token-limits.js";
import { OpenAIResponsesModel } from "./openai-responses-model.js";

export function createModel({ traceLogger } = {}) {
  const provider = process.env.MODEL_PROVIDER ?? "openai-compatible";
  const maxOutputTokensOverride = configuredMaxOutputTokens();
  const stream = process.env.LLM_STREAM !== "false";
  const requestTimeoutMs = Number.parseInt(process.env.LLM_REQUEST_TIMEOUT_MS ?? "45000", 10);
  const firstByteTimeoutMs = Number.parseInt(
    process.env.LLM_FIRST_BYTE_TIMEOUT_MS ?? "12000",
    10,
  );
  const streamIdleTimeoutMs = Number.parseInt(
    process.env.LLM_STREAM_IDLE_TIMEOUT_MS ?? "12000",
    10,
  );
  const retryLimit = Number.parseInt(process.env.LLM_RETRY_LIMIT ?? "1", 10);
  const retryBackoffMs = Number.parseInt(process.env.LLM_RETRY_BACKOFF_MS ?? "750", 10);

  if (provider === "anthropic") {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;
    const model = process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5";

    if (!anthropicApiKey) {
      throw new Error(
        "Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Please configure lesson4/.env.local or export it in your shell.",
      );
    }

    return new AnthropicMessagesModel({
      apiKey: anthropicApiKey,
      model,
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
      anthropicVersion: process.env.ANTHROPIC_VERSION ?? "2023-06-01",
      maxOutputTokens: maxOutputTokensForModelWithOverride(model, maxOutputTokensOverride),
      requestTimeoutMs,
      firstByteTimeoutMs,
      streamIdleTimeoutMs,
      retryLimit,
      retryBackoffMs,
      stream,
      trace: process.env.LLM_TRACE !== "false",
      traceLogger,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure lesson4/.env.local or export it in your shell.");
  }

  const model = process.env.OPENAI_MODEL ?? "minimax-m2.5";

  return new OpenAIResponsesModel({
    apiKey: process.env.OPENAI_API_KEY,
    model,
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/coding/v3",
    maxOutputTokens: maxOutputTokensForModelWithOverride(model, maxOutputTokensOverride),
    requestTimeoutMs,
    firstByteTimeoutMs,
    streamIdleTimeoutMs,
    retryLimit,
    retryBackoffMs,
    stream,
    trace: process.env.LLM_TRACE !== "false",
    traceLogger,
  });
}
