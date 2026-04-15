import { afterEach, test } from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import process from "node:process";

import { webSearchTool } from "../src/tools/web-search.js";

const originalEnv = {
  CLAWD_WEB_SEARCH_BASE_URL: process.env.CLAWD_WEB_SEARCH_BASE_URL,
  WEB_SEARCH_TIMEOUT_MS: process.env.WEB_SEARCH_TIMEOUT_MS,
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

async function withSearchServer(callback) {
  const server = createServer((request, response) => {
    const address = server.address();
    response.writeHead(200, { "content-type": "text/html; charset=utf-8" });
    response.end(
      [
        "<html><body>",
        `<a class="result__a" href="/l/?uddg=${encodeURIComponent(`http://127.0.0.1:${address.port}/allowed`)}">Allowed Local Result</a>`,
        `<a class="result__a" href="/l/?uddg=${encodeURIComponent(`http://127.0.0.1:${address.port}/fallback`)}">Second Local Result</a>`,
        '<a class="result__a" href="/l/?uddg=https%3A%2F%2Fblocked.example.com%2Fsecret">Blocked Result</a>',
        "</body></html>",
      ].join(""),
    );
  });

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

test("WebSearch returns claw-code style results and filters blocked domains", async () => {
  await withSearchServer(async (baseUrl) => {
    process.env.CLAWD_WEB_SEARCH_BASE_URL = `${baseUrl}/search`;
    process.env.WEB_SEARCH_TIMEOUT_MS = "2000";

    const result = await webSearchTool.execute({
      query: "lesson11 fixture",
      blocked_domains: ["blocked.example.com"],
    });

    const hits = result.results?.[1]?.content ?? [];

    assert.equal(result.query, "lesson11 fixture");
    assert.equal(typeof result.durationSeconds, "number");
    assert.match(result.results[0], /Include a Sources section/);
    assert.equal(hits.length, 2);
    assert.equal(hits[0].title, "Allowed Local Result");
    assert.equal(hits[0].url, `${baseUrl}/allowed`);
    assert.equal(hits.some((hit) => hit.url.includes("blocked.example.com")), false);
  });
});

test("WebSearch supports allowed_domains filtering", async () => {
  await withSearchServer(async (baseUrl) => {
    process.env.CLAWD_WEB_SEARCH_BASE_URL = `${baseUrl}/search`;

    const result = await webSearchTool.execute({
      query: "allowed only",
      allowed_domains: ["127.0.0.1"],
    });

    const hits = result.results?.[1]?.content ?? [];
    assert.equal(hits.length, 2);
    assert.equal(hits.every((hit) => hit.url.startsWith(baseUrl)), true);
  });
});
