import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import process from "node:process";

import { webFetchTool } from "../src/tools/web-fetch.js";

const originalEnv = {
  WEB_FETCH_TIMEOUT_MS: process.env.WEB_FETCH_TIMEOUT_MS,
};

afterEach(() => {
  restoreEnv();
});

function restoreEnv() {
  for (const [key, value] of Object.entries(originalEnv)) {
    if (value === undefined) {
      delete process.env[key];
      continue;
    }

    process.env[key] = value;
  }
}

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

test("WebFetch returns a claw-code style summary for HTML pages", async () => {
  await withServer((request, response) => {
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      [
        "<html><head><title>Fixture Title</title></head><body>",
        "<h1>Fixture Title</h1>",
        "<p>Hello from the local fixture.</p>",
        "</body></html>",
      ].join(""),
    );
  }, async (baseUrl) => {
    process.env.WEB_FETCH_TIMEOUT_MS = "2000";

    const result = await webFetchTool.execute({
      url: `${baseUrl}/page`,
      prompt: "Extract the title from this page.",
    });

    assert.equal(result.code, 200);
    assert.equal(result.codeText, "OK");
    assert.equal(result.url, `${baseUrl}/page`);
    assert.match(result.result, /Fetched .*\/page/);
    assert.match(result.result, /Title: Fixture Title/);
    assert.equal(typeof result.durationMs, "number");
    assert.equal(result.bytes > 0, true);
  });
});

test("WebFetch keeps localhost http URLs instead of forcing https", async () => {
  await withServer((request, response) => {
    response.writeHead(200, { "content-type": "text/plain; charset=utf-8" });
    response.end("local text fixture");
  }, async (baseUrl) => {
    const result = await webFetchTool.execute({
      url: `${baseUrl}/plain`,
      prompt: "Summarize the main content of this page.",
    });

    assert.equal(result.url, `${baseUrl}/plain`);
    assert.match(result.result, /local text fixture/);
  });
});
