import { afterEach, test } from "node:test";
import assert from "node:assert/strict";

import { createModel } from "../src/model/create-model.js";

const originalEnv = {
  MODEL_PROVIDER: process.env.MODEL_PROVIDER,
  OPENAI_API_KEY: process.env.OPENAI_API_KEY,
  OPENAI_BASE_URL: process.env.OPENAI_BASE_URL,
  OPENAI_MODEL: process.env.OPENAI_MODEL,
  LLM_REQUEST_TIMEOUT_MS: process.env.LLM_REQUEST_TIMEOUT_MS,
  LLM_FIRST_BYTE_TIMEOUT_MS: process.env.LLM_FIRST_BYTE_TIMEOUT_MS,
  LLM_STREAM_IDLE_TIMEOUT_MS: process.env.LLM_STREAM_IDLE_TIMEOUT_MS,
};

afterEach(() => {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
    } else {
      process.env[key] = value;
    }
  }
});

test("createModel defaults first-byte and stream-idle timeouts to request timeout when not explicitly configured", () => {
  process.env.MODEL_PROVIDER = "openai-compatible";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
  process.env.OPENAI_MODEL = "minimax-m2.5";
  process.env.LLM_REQUEST_TIMEOUT_MS = "23456";
  delete process.env.LLM_FIRST_BYTE_TIMEOUT_MS;
  delete process.env.LLM_STREAM_IDLE_TIMEOUT_MS;

  const model = createModel();

  assert.equal(model.requestTimeoutMs, 23456);
  assert.equal(model.firstByteTimeoutMs, 23456);
  assert.equal(model.streamIdleTimeoutMs, 23456);
});

test("createModel preserves explicit first-byte and stream-idle timeout overrides", () => {
  process.env.MODEL_PROVIDER = "openai-compatible";
  process.env.OPENAI_API_KEY = "test-key";
  process.env.OPENAI_BASE_URL = "http://127.0.0.1:1";
  process.env.OPENAI_MODEL = "minimax-m2.5";
  process.env.LLM_REQUEST_TIMEOUT_MS = "23456";
  process.env.LLM_FIRST_BYTE_TIMEOUT_MS = "3456";
  process.env.LLM_STREAM_IDLE_TIMEOUT_MS = "4567";

  const model = createModel();

  assert.equal(model.requestTimeoutMs, 23456);
  assert.equal(model.firstByteTimeoutMs, 3456);
  assert.equal(model.streamIdleTimeoutMs, 4567);
});
