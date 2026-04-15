export class Session {
  constructor() {
    this.messages = [];
  }

  addMessage(role, content) {
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

  addToolMessage(toolName, content) {
    this.addMessage("tool", { toolName, content });
  }

  snapshot() {
    return [...this.messages];
  }
}
