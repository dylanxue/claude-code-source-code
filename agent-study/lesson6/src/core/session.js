import { createSessionId } from "./session-store.js";

export class Session {
  constructor({
    sessionId = createSessionId(),
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    messages = [],
    persistencePath = null,
    compaction = null,
  } = {}) {
    this.version = 1;
    this.sessionId = sessionId;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.messages = [];
    this.persistencePath = persistencePath;
    this.compaction = compaction;

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
  }

  recordCompaction({ summary, removedMessageCount }) {
    this.updatedAt = new Date().toISOString();
    this.compaction = {
      count: (this.compaction?.count ?? 0) + 1,
      removedMessageCount,
      summary,
      updatedAt: this.updatedAt,
    };
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
    });
  }
}
