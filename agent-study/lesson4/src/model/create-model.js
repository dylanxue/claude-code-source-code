import { AnthropicMessagesModel } from "./anthropic-messages-model.js";
import { OpenAIResponsesModel } from "./openai-responses-model.js";

export function createModel({ traceLogger } = {}) {
  const provider = process.env.MODEL_PROVIDER ?? "openai-compatible";

  if (provider === "anthropic") {
    const anthropicApiKey = process.env.ANTHROPIC_API_KEY ?? process.env.ANTHROPIC_AUTH_TOKEN;

    if (!anthropicApiKey) {
      throw new Error(
        "Missing ANTHROPIC_API_KEY or ANTHROPIC_AUTH_TOKEN. Please configure lesson4/.env.local or export it in your shell.",
      );
    }

    return new AnthropicMessagesModel({
      apiKey: anthropicApiKey,
      model: process.env.ANTHROPIC_MODEL ?? "claude-sonnet-4-5",
      baseUrl: process.env.ANTHROPIC_BASE_URL ?? "https://api.anthropic.com/v1",
      anthropicVersion: process.env.ANTHROPIC_VERSION ?? "2023-06-01",
      trace: process.env.LLM_TRACE !== "false",
      traceLogger,
    });
  }

  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure lesson4/.env.local or export it in your shell.");
  }

  return new OpenAIResponsesModel({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "minimax-m2.5",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/coding/v3",
    trace: process.env.LLM_TRACE !== "false",
    traceLogger,
  });
}
