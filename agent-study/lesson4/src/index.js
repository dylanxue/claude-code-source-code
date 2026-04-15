import { createAgentApp } from "./bootstrap/create-agent-app.js";
import { lessonNotes } from "./lesson-notes.js";

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

  const app = createAgentApp({
    workspaceRoot: process.cwd(),
    resume,
  });

  console.log(`Model mode: ${app.modelMode}`);
  console.log(`Session ID: ${app.sessionId}`);
  console.log(`LLM trace: ${process.env.LLM_TRACE !== "false" ? "file" : "off"}`);
  if (process.env.LLM_TRACE !== "false") {
    console.log(`Trace log: ${app.traceLogPath}`);
    console.log(`Run summary: ${app.summaryLogPath}`);
  }
  const result = await app.run(prompt);
  console.log(`Session file: ${result.sessionPath}`);
  console.log(result.output);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
