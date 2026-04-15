import { ToolRegistry } from "../core/tool-registry.js";
import { createAgentTool } from "../tools/agent.js";
import { bashTool } from "../tools/bash.js";
import { editFileTool } from "../tools/edit-file.js";
import { globSearchTool } from "../tools/glob-search.js";
import { grepSearchTool, grepTextTool } from "../tools/grep-text.js";
import { listFilesTool } from "../tools/list-files.js";
import { readFileTool } from "../tools/read-file.js";
import { skillTool } from "../tools/skill.js";
import { structuredOutputTool } from "../tools/structured-output.js";
import { runTaskPacketTool } from "../tools/run-task-packet.js";
import { taskCreateTool } from "../tools/task-create.js";
import { taskGetTool } from "../tools/task-get.js";
import { taskListTool } from "../tools/task-list.js";
import { taskOutputTool } from "../tools/task-output.js";
import { taskStopTool } from "../tools/task-stop.js";
import { taskUpdateTool } from "../tools/task-update.js";
import { createToolSearchTool } from "../tools/tool-search.js";
import { todoWriteTool } from "../tools/todo-write.js";
import { webFetchTool } from "../tools/web-fetch.js";
import { webSearchTool } from "../tools/web-search.js";
import { createWorkerAwaitReadyTool } from "../tools/worker-await-ready.js";
import { createWorkerCreateTool } from "../tools/worker-create.js";
import { createWorkerGetTool } from "../tools/worker-get.js";
import { createWorkerSendPromptTool } from "../tools/worker-send-prompt.js";
import { writeFileTool } from "../tools/write-file.js";

function shouldRegister(toolName, allowedToolNames) {
  if (!allowedToolNames) {
    return true;
  }

  return allowedToolNames.has(toolName);
}

export function registerDefaultTools(
  toolRegistry,
  { allowedToolNames = null, runSubagent = null, workerControl = null } = {},
) {
  const allowed =
    allowedToolNames instanceof Set
      ? allowedToolNames
      : allowedToolNames
        ? new Set(allowedToolNames)
        : null;

  for (const tool of [
    listFilesTool,
    globSearchTool,
    readFileTool,
    grepSearchTool,
    grepTextTool,
    writeFileTool,
    editFileTool,
    bashTool,
    webFetchTool,
    webSearchTool,
    todoWriteTool,
    skillTool,
    structuredOutputTool,
    taskCreateTool,
    runTaskPacketTool,
    taskGetTool,
    taskListTool,
    taskStopTool,
    taskUpdateTool,
    taskOutputTool,
  ]) {
    if (shouldRegister(tool.name, allowed)) {
      toolRegistry.register(tool);
    }
  }

  if (runSubagent && shouldRegister("Agent", allowed)) {
    toolRegistry.register(createAgentTool({ runSubagent }));
  }

  if (workerControl) {
    const workerTools = [
      ["WorkerCreate", createWorkerCreateTool({ createWorker: workerControl.createWorker })],
      ["WorkerGet", createWorkerGetTool({ getWorker: workerControl.getWorker })],
      ["WorkerAwaitReady", createWorkerAwaitReadyTool({ awaitWorkerReady: workerControl.awaitWorkerReady })],
      ["WorkerSendPrompt", createWorkerSendPromptTool({ sendWorkerPrompt: workerControl.sendWorkerPrompt })],
    ];

    for (const [toolName, tool] of workerTools) {
      if (shouldRegister(toolName, allowed)) {
        toolRegistry.register(tool);
      }
    }
  }

  if (shouldRegister("ToolSearch", allowed)) {
    toolRegistry.register(createToolSearchTool(toolRegistry));
  }

  return toolRegistry;
}

export function createDefaultToolRegistry(options = {}) {
  const toolRegistry = new ToolRegistry();
  return registerDefaultTools(toolRegistry, options);
}
