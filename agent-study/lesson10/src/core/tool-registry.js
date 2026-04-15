function validatePrimitiveType(value, expectedType) {
  if (expectedType === "array") {
    return Array.isArray(value);
  }

  return typeof value === expectedType;
}

function validateInputAgainstSchema(input, schema) {
  if (!schema) {
    return;
  }

  if (typeof input !== "object" || input === null || Array.isArray(input)) {
    throw new Error("Tool input must be an object.");
  }

  const properties = schema.properties ?? {};
  const required = schema.required ?? [];

  for (const field of required) {
    if (!(field in input)) {
      throw new Error(`Missing required field: ${field}`);
    }
  }

  for (const [field, definition] of Object.entries(properties)) {
    if (!(field in input) || input[field] === undefined) {
      continue;
    }

    if (!validatePrimitiveType(input[field], definition.type)) {
      throw new Error(`Invalid type for "${field}". Expected ${definition.type}.`);
    }
  }
}

export class ToolRegistry {
  constructor() {
    this.tools = new Map();
  }

  register(tool) {
    if (!tool?.name || typeof tool.execute !== "function" || !tool.description) {
      throw new Error("Tool must include name, description, and execute(input, context).");
    }

    this.tools.set(tool.name, tool);
  }

  getTool(name) {
    return this.tools.get(name);
  }

  getToolMetadata(name) {
    const tool = this.getTool(name);
    if (!tool) {
      return null;
    }

    return {
      name: tool.name,
      family: tool.family ?? null,
    };
  }

  describeToolCall(toolName, input, context = {}) {
    const tool = this.getTool(toolName);
    const metadata = this.getToolMetadata(toolName) ?? {
      name: toolName,
      family: null,
    };
    const describedCall =
      tool && typeof tool.describeCall === "function" ? tool.describeCall(input, context) : {};

    return {
      toolName,
      toolFamily: metadata.family,
      input: input ?? null,
      toolCallId: context.toolCallId ?? null,
      ...(describedCall ?? {}),
    };
  }

  getPreToolUseHooks(toolName) {
    const tool = this.getTool(toolName);
    if (!tool || !Array.isArray(tool.preToolUseHooks)) {
      return [];
    }

    return tool.preToolUseHooks.filter((hook) => typeof hook === "function");
  }

  listTools() {
    return [...this.tools.values()].map(({ name, description, inputSchema }) => ({
      name,
      description,
      inputSchema,
    }));
  }

  async execute(name, input, context) {
    const tool = this.getTool(name);

    if (!tool) {
      throw new Error(`Unknown tool: ${name}`);
    }

    validateInputAgainstSchema(input, tool.inputSchema);
    return tool.execute(input, context);
  }
}
