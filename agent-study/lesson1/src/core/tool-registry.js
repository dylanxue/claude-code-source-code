export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.name || typeof tool.execute !== "function") {
      throw new Error("Tool must include a name and execute(input, context) method.");
    }

    this.tools.set(tool.name, tool);
  }

  getTool(name) {
    return this.tools.get(name);
  }

  listTools() {
    return [...this.tools.values()].map(({ name, description }) => ({
      name,
      description,
    }));
  }

  async execute(name, input, context) {
    const tool = this.getTool(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    return tool.execute(input, context);
  }
}
