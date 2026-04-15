import { createAgentApp } from "./bootstrap/create-agent-app.js";
import { lessonNotes } from "./lesson-notes.js";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();

  if (!prompt) {
    console.log("Usage:");
    console.log('  npm start -- "请阅读 src/index.js 并解释入口流程"');
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
  });

  console.log(`Model mode: ${app.modelMode}`);
  console.log(`LLM trace: ${process.env.LLM_TRACE !== "false" ? "file" : "off"}`);
  if (process.env.LLM_TRACE !== "false") {
    console.log(`Trace log: ${app.traceLogPath}`);
    console.log(`Run summary: ${app.summaryLogPath}`);
  }
  const result = await app.run(prompt);
  console.log(result.output);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
