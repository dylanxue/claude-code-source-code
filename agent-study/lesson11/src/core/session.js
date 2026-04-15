import { createSessionId } from "./session-store.js";

function normalizeUsage(usage = null) {
  const currentUsage = usage?.currentUsage ?? null;

  return {
    inputTokens: Number(usage?.inputTokens ?? 0),
    outputTokens: Number(usage?.outputTokens ?? 0),
    cacheCreationInputTokens: Number(usage?.cacheCreationInputTokens ?? 0),
    cacheReadInputTokens: Number(usage?.cacheReadInputTokens ?? 0),
    currentUsage: {
      inputTokens: Number(currentUsage?.inputTokens ?? 0),
      outputTokens: Number(currentUsage?.outputTokens ?? 0),
      cacheCreationInputTokens: Number(currentUsage?.cacheCreationInputTokens ?? 0),
      cacheReadInputTokens: Number(currentUsage?.cacheReadInputTokens ?? 0),
    },
  };
}

export class Session {
  constructor({
    sessionId = createSessionId(),
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    messages = [],
    persistencePath = null,
    compaction = null,
    usage = null,
  } = {}) {
    this.version = 1;
    this.sessionId = sessionId;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.messages = [];
    this.persistencePath = persistencePath;
    this.compaction = compaction;
    this.usage = normalizeUsage(usage);

    for (const message of messages) {
      this.messages.push(message);
    }
  }

  addMessage(role, content) {
    this.updatedAt = new Date().toISOString();
    this.messages.push({
      role,
      content,
      createdAt: new Date().toISOString(),
    });
  }

  addUserMessage(content) {
    this.addMessage("user", content);
  }

  addAssistantMessage(content) {
    this.addMessage("assistant", content);
  }

  addToolMessage(toolName, result) {
    this.addMessage("tool", {
      toolName,
      ...result,
    });
  }

  clone(overrides = {}) {
    return new Session({
      sessionId: overrides.sessionId ?? this.sessionId,
      createdAt: overrides.createdAt ?? this.createdAt,
      updatedAt: overrides.updatedAt ?? this.updatedAt,
      messages: overrides.messages ?? this.messages,
      persistencePath: overrides.persistencePath ?? this.persistencePath,
      compaction: overrides.compaction ?? this.compaction,
      usage: overrides.usage ?? this.usage,
    });
  }

  replaceWith(nextSession) {
    this.version = nextSession.version;
    this.sessionId = nextSession.sessionId;
    this.createdAt = nextSession.createdAt;
    this.updatedAt = nextSession.updatedAt;
    this.messages = [...nextSession.messages];
    this.persistencePath = nextSession.persistencePath;
    this.compaction = nextSession.compaction;
    this.usage = nextSession.usage;
  }

  recordCompaction({ summary, removedMessageCount, lastCompactionInputTokens = null }) {
    this.updatedAt = new Date().toISOString();
    this.compaction = {
      count: (this.compaction?.count ?? 0) + 1,
      removedMessageCount,
      summary,
      lastCompactionInputTokens:
        lastCompactionInputTokens ?? this.compaction?.lastCompactionInputTokens ?? null,
      updatedAt: this.updatedAt,
    };
  }

  recordUsage(usage) {
    this.updatedAt = new Date().toISOString();
    this.usage = normalizeUsage(usage);
  }

  snapshot() {
    return [...this.messages];
  }

  toJSON() {
    return {
      version: this.version,
      sessionId: this.sessionId,
      createdAt: this.createdAt,
      updatedAt: this.updatedAt,
      messages: this.messages,
      compaction: this.compaction,
      usage: this.usage,
    };
  }

  static fromJSON(payload, persistencePath = null) {
    return new Session({
      sessionId: payload.sessionId,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      messages: payload.messages ?? [],
      persistencePath,
      compaction: payload.compaction ?? null,
      usage: payload.usage ?? null,
    });
  }
}
