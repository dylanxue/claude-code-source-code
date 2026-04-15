const DEFAULT_WEB_SEARCH_BASE_URL = "https://html.duckduckgo.com/html/";
const DEFAULT_WEB_SEARCH_TIMEOUT_MS = 20_000;

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

function buildSearchUrl(query) {
  const baseUrl = process.env.CLAWD_WEB_SEARCH_BASE_URL ?? DEFAULT_WEB_SEARCH_BASE_URL;
  const url = new URL(baseUrl);
  url.searchParams.append("q", query);
  return url.toString();
}

function extractQuotedValue(input) {
  const source = String(input ?? "");
  const quote = source[0];
  if (!quote || !['"', "'"].includes(quote)) {
    return null;
  }
  const end = source.indexOf(quote, 1);
  if (end === -1) {
    return null;
  }

  return {
    value: source.slice(1, end),
    rest: source.slice(end + 1),
  };
}

function htmlEntityDecodeUrl(url) {
  return decodeHtmlEntities(url);
}

function decodeDuckDuckGoRedirect(url) {
  const rawUrl = String(url ?? "");
  if (rawUrl.startsWith("http://") || rawUrl.startsWith("https://")) {
    return htmlEntityDecodeUrl(rawUrl);
  }

  const joined = rawUrl.startsWith("//")
    ? `https:${rawUrl}`
    : rawUrl.startsWith("/")
      ? `https://duckduckgo.com${rawUrl}`
      : null;
  if (!joined) {
    return null;
  }

  const parsed = new URL(joined);
  if (parsed.pathname === "/l/" || parsed.pathname === "/l") {
    const uddg = parsed.searchParams.get("uddg");
    if (uddg) {
      return htmlEntityDecodeUrl(uddg);
    }
  }

  return joined;
}

function extractSearchHits(html) {
  const hits = [];
  let remaining = String(html ?? "");

  while (true) {
    const anchorStart = remaining.indexOf("result__a");
    if (anchorStart === -1) {
      break;
    }

    const afterClass = remaining.slice(anchorStart);
    const hrefIdx = afterClass.indexOf("href=");
    if (hrefIdx === -1) {
      remaining = afterClass.slice(1);
      continue;
    }

    const quoted = extractQuotedValue(afterClass.slice(hrefIdx + 5));
    if (!quoted) {
      remaining = afterClass.slice(1);
      continue;
    }

    const closeTagIdx = quoted.rest.indexOf(">");
    if (closeTagIdx === -1) {
      remaining = afterClass.slice(1);
      continue;
    }

    const afterTag = quoted.rest.slice(closeTagIdx + 1);
    const endAnchorIdx = afterTag.indexOf("</a>");
    if (endAnchorIdx === -1) {
      remaining = afterTag.slice(1);
      continue;
    }

    const title = htmlToText(afterTag.slice(0, endAnchorIdx)).trim();
    const decodedUrl = decodeDuckDuckGoRedirect(quoted.value);
    if (title && decodedUrl) {
      hits.push({ title, url: decodedUrl });
    }

    remaining = afterTag.slice(endAnchorIdx + 4);
  }

  return hits;
}

function extractSearchHitsFromGenericLinks(html) {
  const hits = [];
  let remaining = String(html ?? "");

  while (true) {
    const anchorStart = remaining.indexOf("<a");
    if (anchorStart === -1) {
      break;
    }

    const afterAnchor = remaining.slice(anchorStart);
    const hrefIdx = afterAnchor.indexOf("href=");
    if (hrefIdx === -1) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const quoted = extractQuotedValue(afterAnchor.slice(hrefIdx + 5));
    if (!quoted) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const closeTagIdx = quoted.rest.indexOf(">");
    if (closeTagIdx === -1) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const afterTag = quoted.rest.slice(closeTagIdx + 1);
    const endAnchorIdx = afterTag.indexOf("</a>");
    if (endAnchorIdx === -1) {
      remaining = afterAnchor.slice(2);
      continue;
    }

    const title = htmlToText(afterTag.slice(0, endAnchorIdx)).trim();
    const decodedUrl = decodeDuckDuckGoRedirect(quoted.value) ?? quoted.value;
    if (title && /^https?:\/\//.test(decodedUrl)) {
      hits.push({ title, url: decodedUrl });
    }

    remaining = afterTag.slice(endAnchorIdx + 4);
  }

  return hits;
}

function normalizeDomainFilter(domain) {
  const trimmed = String(domain ?? "").trim();
  if (!trimmed) {
    return "";
  }

  try {
    return new URL(trimmed).hostname.toLowerCase();
  } catch {
    return trimmed.replace(/^\.+/, "").replace(/\/+$/, "").toLowerCase();
  }
}

function hostMatchesList(url, domains) {
  let host;
  try {
    host = new URL(url).hostname.toLowerCase();
  } catch {
    return false;
  }

  return domains.some((domain) => {
    const normalized = normalizeDomainFilter(domain);
    return normalized && (host === normalized || host.endsWith(`.${normalized}`));
  });
}

function dedupeHits(hits) {
  const seen = new Set();
  return hits.filter((hit) => {
    if (seen.has(hit.url)) {
      return false;
    }
    seen.add(hit.url);
    return true;
  });
}

export const webSearchTool = {
  name: "WebSearch",
  family: "web",
  description: "Search the web for current information and return cited results.",
  inputSchema: {
    type: "object",
    required: ["query"],
    properties: {
      query: { type: "string" },
      allowed_domains: { type: "array", items: { type: "string" } },
      blocked_domains: { type: "array", items: { type: "string" } },
    },
  },
  async execute(input) {
    const startedAt = Date.now();
    const timeoutMs = Number(process.env.WEB_SEARCH_TIMEOUT_MS ?? DEFAULT_WEB_SEARCH_TIMEOUT_MS);
    const abortController = new AbortController();
    const timeout = setTimeout(() => abortController.abort(), timeoutMs);

    try {
      const response = await fetch(buildSearchUrl(input.query), {
        redirect: "follow",
        signal: abortController.signal,
        headers: {
          "user-agent": "agent-study-web-tools/0.1",
        },
      });
      const html = await response.text();

      let hits = extractSearchHits(html);
      if (hits.length === 0 && response.url) {
        hits = extractSearchHitsFromGenericLinks(html);
      }

      if (Array.isArray(input.allowed_domains)) {
        hits = hits.filter((hit) => hostMatchesList(hit.url, input.allowed_domains));
      }
      if (Array.isArray(input.blocked_domains)) {
        hits = hits.filter((hit) => !hostMatchesList(hit.url, input.blocked_domains));
      }

      hits = dedupeHits(hits).slice(0, 8);

      const summary = hits.length === 0
        ? `No web search results matched the query "${input.query}".`
        : `Search results for "${input.query}". Include a Sources section in the final answer.\n${hits.map((hit) => `- [${hit.title}](${hit.url})`).join("\n")}`;

      return {
        query: input.query,
        results: [
          summary,
          {
            tool_use_id: "web_search_1",
            content: hits,
          },
        ],
        durationSeconds: (Date.now() - startedAt) / 1000,
      };
    } finally {
      clearTimeout(timeout);
    }
  },
};
