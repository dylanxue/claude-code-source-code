const DEFAULT_FETCH_TIMEOUT_MS = 20_000;

function decodeHtmlEntities(input) {
  return String(input ?? "")
    .replaceAll("&amp;", "&")
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&#39;", "'")
    .replaceAll("&nbsp;", " ");
}

function collapseWhitespace(input) {
  return String(input ?? "").split(/\s+/).filter(Boolean).join(" ");
}

function htmlToText(html) {
  return collapseWhitespace(
    decodeHtmlEntities(String(html ?? "").replace(/<[^>]*>/g, " ")),
  );
}

function previewText(input, maxChars) {
  const normalized = String(input ?? "");
  if ([...normalized].length <= maxChars) {
    return normalized;
  }

  return `${[...normalized].slice(0, maxChars).join("").trimEnd()}…`;
}

function extractTitle(content, rawBody, contentType) {
  if (contentType.includes("html")) {
    const match = String(rawBody ?? "").match(/<title[^>]*>([\s\S]*?)<\/title>/i);
    if (match?.[1]) {
      const title = collapseWhitespace(decodeHtmlEntities(match[1]));
      if (title) {
        return title;
      }
    }
  }

  for (const line of String(content ?? "").split("\n")) {
    const trimmed = line.trim();
    if (trimmed) {
      return trimmed;
    }
  }

  return null;
}

function summarizeWebFetch(url, prompt, content, rawBody, contentType) {
  const lowerPrompt = String(prompt ?? "").toLowerCase();
  const compact = collapseWhitespace(content);

  let detail;
  if (lowerPrompt.includes("title")) {
    detail = extractTitle(content, rawBody, contentType) ?? previewText(compact, 600);
    if (!detail.startsWith("Title:")) {
      detail = `Title: ${detail}`;
    }
  } else if (lowerPrompt.includes("summary") || lowerPrompt.includes("summarize")) {
    detail = previewText(compact, 900);
  } else {
    detail = `Prompt: ${prompt}\nContent preview:\n${previewText(compact, 900)}`;
  }

  return `Fetched ${url}\n${detail}`;
}

function normalizeFetchedContent(body, contentType) {
  return String(contentType ?? "").includes("html") ? htmlToText(body) : String(body ?? "").trim();
}

function normalizeFetchUrl(url) {
  const parsed = new URL(String(url));
  if (parsed.protocol === "http:") {
    const host = parsed.hostname;
    if (!["localhost", "127.0.0.1", "::1"].includes(host)) {
      parsed.protocol = "https:";
    }
  }

  return parsed.toString();
}

export const webFetchTool = {
  name: "WebFetch",
  family: "web",
  description: "Fetch a URL, convert it into readable text, and answer a prompt about it.",
  inputSchema: {
    type: "object",
    required: ["url", "prompt"],
    properties: {
      url: { type: "string" },
      prompt: { type: "string" },
    },
  },
  async execute(input) {
    const startedAt = Date.now();
    const requestUrl = normalizeFetchUrl(input.url);
    const timeoutMs = Number(process.env.WEB_FETCH_TIMEOUT_MS ?? DEFAULT_FETCH_TIMEOUT_MS);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(requestUrl, {
        redirect: "follow",
        signal: abortController.signal,
        headers: {
          "user-agent": "agent-study-web-tools/0.1",
        },
      });

      const finalUrl = response.url;
      const body = await response.text();
      const contentType = response.headers.get("content-type") ?? "";
      const normalized = normalizeFetchedContent(body, contentType);
      const result = summarizeWebFetch(finalUrl, input.prompt, normalized, body, contentType);

      return {
        bytes: body.length,
        code: response.status,
        codeText: response.statusText || "Unknown",
        result,
        durationMs: Date.now() - startedAt,
        url: finalUrl,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
