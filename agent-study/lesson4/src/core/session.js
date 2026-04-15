import { createSessionId } from "./session-store.js";

export class Session {
  constructor({
    sessionId = createSessionId(),
    createdAt = new Date().toISOString(),
    updatedAt = createdAt,
    messages = [],
    persistencePath = null,
  } = {}) {
    this.version = 1;
    this.sessionId = sessionId;
    this.createdAt = createdAt;
    this.updatedAt = updatedAt;
    this.messages = [];
    this.persistencePath = persistencePath;

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
    };
  }

  static fromJSON(payload, persistencePath = null) {
    return new Session({
      sessionId: payload.sessionId,
      createdAt: payload.createdAt,
      updatedAt: payload.updatedAt,
      messages: payload.messages ?? [],
      persistencePath,
    });
  }
}
