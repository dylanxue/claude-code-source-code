import { test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";

import { OpenAIResponsesModel } from "../src/model/openai-responses-model.js";

async function withServer(handler, callback) {
  const server = createServer(handler);

  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", resolve);
  });

  const address = server.address();
  const baseUrl = `http://127.0.0.1:${address.port}`;

  try {
    await callback(baseUrl);
  } finally {
    await new Promise((resolve, reject) => {
      server.close((error) => {
        if (error) {
          reject(error);
          return;
        }
        resolve();
      });
    });
  }
}

function buildJsonResponse(content) {
  return JSON.stringify({
    choices: [
      {
        finish_reason: "stop",
        message: {
          role: "assistant",
          content,
        },
      },
    ],
    usage: null,
  });
}

test("OpenAIResponsesModel retries once after first-byte timeout and emits a retry event", async () => {
  let requestCount = 0;

  await withServer((request, response) => {
    requestCount += 1;

    if (requestCount === 1) {
      setTimeout(() => {
        response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
        response.end(buildJsonResponse("too late"));
      }, 250);
      return;
    }

    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(buildJsonResponse("retry ok"));
  }, async (baseUrl) => {
    const model = new OpenAIResponsesModel({
      apiKey: "test-key",
      model: "minimax-m2.5",
      baseUrl,
      maxOutputTokens: 256,
      requestTimeoutMs: 500,
      firstByteTimeoutMs: 120,
      stream: false,
      retryLimit: 1,
      retryBackoffMs: 1,
      trace: false,
    });

    const events = [];
    const result = await model.decide({
      systemPrompt: "test",
      messages: [{ role: "user", kind: "text", text: "hello" }],
      tools: [],
      iteration: 1,
      onAssistantEvent(event) {
        events.push(event);
      },
    });

    assert.equal(result.type, "final");
    assert.equal(result.output, "retry ok");
    assert.equal(requestCount, 2);
    assert.equal(events.some((event) => event.type === "model_retry"), true);
  });
});

test("OpenAIResponsesModel retries on retryable upstream status codes", async () => {
  let requestCount = 0;

  await withServer((request, response) => {
    requestCount += 1;

    if (requestCount === 1) {
      response.writeHead(503, { "content-type": "text/plain; charset=utf-8" });
      response.end("temporary upstream overload");
      return;
    }

    response.writeHead(200, { "content-type": "application/json; charset=utf-8" });
    response.end(buildJsonResponse("status retry ok"));
  }, async (baseUrl) => {
    const model = new OpenAIResponsesModel({
      apiKey: "test-key",
      model: "minimax-m2.5",
      baseUrl,
      maxOutputTokens: 256,
      requestTimeoutMs: 500,
      firstByteTimeoutMs: 200,
      stream: false,
      retryLimit: 1,
      retryBackoffMs: 1,
      trace: false,
    });

    const events = [];
    const result = await model.decide({
      systemPrompt: "test",
      messages: [{ role: "user", kind: "text", text: "hello" }],
      tools: [],
      iteration: 1,
      onAssistantEvent(event) {
        events.push(event);
      },
    });

    assert.equal(result.type, "final");
    assert.equal(result.output, "status retry ok");
    assert.equal(requestCount, 2);
    assert.equal(events.some((event) => event.type === "model_retry"), true);
  });
});
