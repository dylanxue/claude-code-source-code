function canonicalToolToken(value) {
  let canonical = String(value ?? "")
    .split("")
    .filter((character) => /[A-Za-z0-9]/.test(character))
    .join("")
    .toLowerCase();

  if (canonical.endsWith("tool")) {
    canonical = canonical.slice(0, -4);
  }

  return canonical;
}

function normalizeToolSearchQuery(query) {
  return String(query ?? "")
    .trim()
    .split(/[\s,]+/)
    .filter(Boolean)
    .map(canonicalToolToken)
    .join(" ");
}

function searchToolSpecs(query, maxResults, specs) {
  const lowered = String(query ?? "").trim().toLowerCase();
  if (lowered.startsWith("select:")) {
    return lowered
      .slice("select:".length)
      .split(",")
      .map((part) => part.trim())
      .filter(Boolean)
      .map(canonicalToolToken)
      .map((wanted) => specs.find((spec) => canonicalToolToken(spec.name) === wanted)?.name ?? null)
      .filter(Boolean)
      .slice(0, maxResults);
  }

  const required = [];
  const optional = [];
  for (const term of lowered.split(/\s+/).filter(Boolean)) {
    if (term.startsWith("+") && term.length > 1) {
      required.push(term.slice(1));
    } else {
      optional.push(term);
    }
  }

  const terms = required.length === 0 ? optional : [...required, ...optional];
  const scored = specs
    .map((spec) => {
      const name = spec.name.toLowerCase();
      const family = String(spec.family ?? "").toLowerCase();
      const canonicalName = canonicalToolToken(spec.name);
      const normalizedDescription = normalizeToolSearchQuery(spec.description);
      const haystack = `${name} ${family} ${String(spec.description ?? "").toLowerCase()} ${canonicalName}`;
      const normalizedHaystack = `${canonicalName} ${family} ${normalizedDescription}`.trim();

      if (required.some((term) => !haystack.includes(term))) {
        return null;
      }

      let score = 0;
      for (const term of terms) {
        const canonicalTerm = canonicalToolToken(term);
        if (haystack.includes(term)) {
          score += 2;
        }
        if (name === term) {
          score += 8;
        }
        if (name.includes(term)) {
          score += 4;
        }
        if (family && family === term) {
          score += 6;
        }
        if (canonicalName === canonicalTerm) {
          score += 12;
        }
        if (normalizedHaystack.includes(canonicalTerm)) {
          score += 3;
        }
      }

      if (score === 0 && lowered) {
        return null;
      }

      return {
        name: spec.name,
        score,
      };
    })
    .filter(Boolean)
    .sort((left, right) => right.score - left.score || left.name.localeCompare(right.name));

  return scored.slice(0, maxResults).map((entry) => entry.name);
}

export function createToolSearchTool(toolRegistry) {
  return {
    name: "ToolSearch",
    family: "tool_discovery",
    description: "Search the available tool surface by name or description and return the best-matching tool names.",
    inputSchema: {
      type: "object",
      required: ["query"],
      properties: {
        query: { type: "string" },
        max_results: { type: "number" },
      },
    },
    async execute(input) {
      const query = String(input.query ?? "").trim();
      const maxResults = Math.max(1, Number(input.max_results ?? 8) || 8);
      const searchableSpecs = toolRegistry.searchableTools();

      return {
        matches: searchToolSpecs(query, maxResults, searchableSpecs),
        query,
        normalized_query: normalizeToolSearchQuery(query),
        total_deferred_tools: searchableSpecs.length,
        pending_mcp_servers: null,
      };
    },
  };
}
