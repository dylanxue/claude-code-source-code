import { createAgentApp } from "./bootstrap/create-agent-app.js";
import { lessonNotes } from "./lesson-notes.js";
import { contextWindowUsage } from "./model/model-token-limits.js";

let cliLogWriter = null;

function parseCliArgs(argv) {
  const args = [...argv];
  let resume = null;
  const promptParts = [];

  while (args.length > 0) {
    const token = args.shift();

    if (token === "--resume") {
      resume = args.shift() ?? "latest";
      continue;
    }

    promptParts.push(token);
  }

  return {
    resume,
    prompt: promptParts.join(" ").trim(),
  };
}

async function main() {
  const { resume, prompt } = parseCliArgs(process.argv.slice(2));
  const streamDebugMode = process.env.LLM_STREAM_DEBUG === "meta" ? "meta" : process.env.LLM_STREAM_DEBUG === "true" ? "echo" : "off";

  function writeToStdoutAndLog(text) {
    process.stdout.write(text);
    cliLogWriter?.(text);
  }

  function logConsoleLine(line = "") {
    console.log(line);
    cliLogWriter?.(`${line}\n`);
  }

  function previewDelta(text) {
    return JSON.stringify(text).slice(1, -1);
  }

  if (!prompt) {
    console.log("Usage:");
    console.log('  npm start -- "请阅读 src/index.js 并解释入口流程"');
    console.log('  npm start -- --resume latest "继续总结当前 session 的上下文"');
    console.log('  npm start -- --resume .sessions/session-xxx.json "继续刚才的任务"');
    console.log('  npm start -- "查找 src 里和 tool 相关的内容，并总结一下"');
    console.log('  npm start -- "运行 `pwd`"');
    console.log('  LLM_TRACE=false npm start -- "请阅读 ../../rust/README.md 并总结它的架构"');
    console.log("");
    console.log("当前课程映射：");

    for (const item of lessonNotes.architecture) {
      console.log(`- ${item.clawCode} -> ${item.nodeVersion}`);
      console.log(`  ${item.takeaway}`);
    }

    process.exit(0);
  }

  const streamingState = {
    started: false,
    wroteText: false,
    wroteReasoning: false,
    currentMode: "meta",
    lastChunkEndedWithNewline: true,
  };

  function ensureStreamingBanner() {
    if (!streamingState.started) {
      streamingState.started = true;
      writeToStdoutAndLog("\n--- Streaming Output ---\n");
      streamingState.lastChunkEndedWithNewline = true;
    }
  }

  function writeStreamingText(text) {
    ensureStreamingBanner();
    if (streamingState.currentMode !== "text") {
      if (!streamingState.lastChunkEndedWithNewline) {
        writeToStdoutAndLog("\n");
      }
      writeToStdoutAndLog("[assistant]\n");
      streamingState.lastChunkEndedWithNewline = true;
      streamingState.currentMode = "text";
    }
    streamingState.wroteText = true;
    if (streamDebugMode === "echo") {
      writeToStdoutAndLog(`\n[text_delta len=${text.length}] ${previewDelta(text)}\n`);
    }
    if (streamDebugMode === "meta") {
      writeToStdoutAndLog(`\n[text_delta len=${text.length}]\n`);
      streamingState.lastChunkEndedWithNewline = true;
    }
    writeToStdoutAndLog(text);
    streamingState.lastChunkEndedWithNewline = text.endsWith("\n");
  }

  function writeStreamingReasoning(text) {
    ensureStreamingBanner();
    if (streamingState.currentMode !== "reasoning") {
      if (!streamingState.lastChunkEndedWithNewline) {
        writeToStdoutAndLog("\n");
      }
      writeToStdoutAndLog("[reasoning]\n");
      streamingState.lastChunkEndedWithNewline = true;
      streamingState.currentMode = "reasoning";
    }
    streamingState.wroteReasoning = true;
    if (streamDebugMode === "echo") {
      writeToStdoutAndLog(`\n[reasoning_delta len=${text.length}] ${previewDelta(text)}\n`);
    }
    if (streamDebugMode === "meta") {
      writeToStdoutAndLog(`\n[reasoning_delta len=${text.length}]\n`);
      streamingState.lastChunkEndedWithNewline = true;
    }
    writeToStdoutAndLog(text);
    streamingState.lastChunkEndedWithNewline = text.endsWith("\n");
  }

  function writeStreamingMeta(line) {
    ensureStreamingBanner();
    if (!streamingState.lastChunkEndedWithNewline) {
      writeToStdoutAndLog("\n");
    }
    writeToStdoutAndLog(`${line}\n`);
    streamingState.currentMode = "meta";
    streamingState.lastChunkEndedWithNewline = true;
  }

  const app = createAgentApp({
    workspaceRoot: process.cwd(),
    resume,
    runtimeCallbacks: {
      onRuntimeEvent(event) {
        if (process.env.LLM_STREAM === "false") {
          return;
        }

        if (event.channel === "assistant_stream" && event.type === "text_delta") {
          writeStreamingText(event.text);
          return;
        }

        if (event.channel === "assistant_stream" && event.type === "text_snapshot") {
          writeStreamingText(event.text);
          return;
        }

        if (event.channel === "assistant_stream" && event.type === "reasoning_delta") {
          writeStreamingReasoning(event.text);
          return;
        }

        if (event.channel === "assistant_stream" && event.type === "reasoning_snapshot") {
          writeStreamingReasoning(event.text);
          return;
        }

        if (event.channel === "assistant_stream" && event.type === "tool_use") {
          writeStreamingMeta(
            `[tool_use] ${event.name} ${JSON.stringify(event.input ?? {}, null, 0)}`,
          );
          return;
        }

        if (event.channel === "assistant_stream" && event.type === "message_stop") {
          writeStreamingMeta(`[message_stop] stop_reason=${event.stopReason ?? "unknown"}`);
          return;
        }

        if (event.channel === "tool_execution" && event.phase === "finish" && !event.ok) {
          writeStreamingMeta(`[tool_error] ${event.toolName}: ${event.error ?? "unknown error"}`);
          return;
        }

        if (event.channel === "tool_result_budget" && event.budget?.truncated) {
          writeStreamingMeta(
            `[tool_result_budget] ${event.toolName} truncated (${event.budget.originalEstimatedChars} -> ${event.budget.storedEstimatedChars} chars, method=${event.budget.method})`,
          );
        }
      },
    },
  });

  cliLogWriter = app.writeCliLog;

  cliLogWriter(`Run ID: ${app.runId}\n`);
  cliLogWriter(`Prompt: ${prompt}\n`);
  const previewBudget = await app.previewRequestBudget(prompt);

  logConsoleLine(`Run ID: ${app.runId}`);
  logConsoleLine(`Model mode: ${app.modelMode}`);
  logConsoleLine(`Session ID: ${app.sessionId}`);
  logConsoleLine(`Session mode: ${app.isResumed ? "resumed" : "new"}`);
  if (app.resumePath) {
    logConsoleLine(`Resume source: ${app.resumePath}`);
  }
  logConsoleLine(`LLM trace: ${process.env.LLM_TRACE !== "false" ? "file" : "off"}`);
  logConsoleLine(`LLM stream: ${process.env.LLM_STREAM !== "false" ? "on" : "off"}`);
  logConsoleLine(`LLM stream debug: ${streamDebugMode}`);
  if (process.env.LLM_TRACE !== "false") {
    logConsoleLine(`Trace log: ${app.traceLogPath}`);
    logConsoleLine(`Run summary: ${app.summaryLogPath}`);
  }
  logConsoleLine(`CLI log: ${app.cliLogPath}`);
  logConsoleLine(
    `Auto compact: preserve ${app.compactionConfig.preserveRecentMessages} recent messages, threshold ${app.compactionConfig.maxEstimatedTokens} est. tokens, ${app.compactionConfig.autoCompactInputTokensThreshold} cumulative input tokens`,
  );
  if (previewBudget) {
    const contextWindow = previewBudget.contextWindowTokens ?? "unknown";
    const estimatedInput = previewBudget.estimatedInputTokens ?? "unknown";
    const estimatedTotal = previewBudget.estimatedTotalTokens ?? "unknown";
    const pressure = Number.isFinite(previewBudget.contextWindowTokens) && Number.isFinite(previewBudget.estimatedTotalTokens)
      ? `${Math.round((previewBudget.estimatedTotalTokens / previewBudget.contextWindowTokens) * 100)}%`
      : "unknown";
    const persistedInput = app.sessionUsage?.inputTokens ?? 0;
    const persistedCurrentUsage = app.sessionUsage?.currentUsage ?? null;
    const currentContextUsage = contextWindowUsage({
      contextWindowTokens: previewBudget.contextWindowTokens ?? null,
      currentUsage: persistedCurrentUsage,
    });
    logConsoleLine(
      `Context budget: window ${contextWindow}, max output est ${estimatedTotal !== "unknown" && estimatedInput !== "unknown" ? estimatedTotal - estimatedInput : "unknown"}, current request est input ${estimatedInput}, current request est total ${estimatedTotal}, pressure ${pressure}`,
    );
    logConsoleLine(`Session usage: cumulative input ${persistedInput}, cumulative output ${app.sessionUsage?.outputTokens ?? 0}`);
    logConsoleLine(
      `Current context usage: input ${persistedCurrentUsage?.inputTokens ?? 0}, output ${persistedCurrentUsage?.outputTokens ?? 0}, cache write ${persistedCurrentUsage?.cacheCreationInputTokens ?? 0}, cache read ${persistedCurrentUsage?.cacheReadInputTokens ?? 0}, used ${currentContextUsage.usedPercentage ?? "unknown"}%, remaining ${currentContextUsage.remainingPercentage ?? "unknown"}%`,
    );
  }
  const result = await app.run(prompt);
  if (streamingState.started) {
    writeToStdoutAndLog("\n");
  }
  logConsoleLine(`Session file: ${result.sessionPath}`);
  if (!streamingState.wroteText) {
    logConsoleLine(result.output);
  }
}

main().catch((error) => {
  const message = error instanceof Error ? error.stack ?? error.message : String(error);
  console.error(error);
  if (cliLogWriter) {
    cliLogWriter(`${message}\n`);
  }
  process.exit(1);
});
