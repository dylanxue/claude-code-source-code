import { OpenAIResponsesModel } from "./openai-responses-model.js";

export function createModel({ traceLogger } = {}) {
  if (!process.env.OPENAI_API_KEY) {
    throw new Error("Missing OPENAI_API_KEY. Please configure lesson3/.env.local or export it in your shell.");
  }

  return new OpenAIResponsesModel({
    apiKey: process.env.OPENAI_API_KEY,
    model: process.env.OPENAI_MODEL ?? "minimax-m2.5",
    baseUrl: process.env.OPENAI_BASE_URL ?? "https://ark.cn-beijing.volces.com/api/coding/v3",
    trace: process.env.LLM_TRACE !== "false",
    traceLogger,
  });
}
