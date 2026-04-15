import { createAgentApp } from "./bootstrap/create-agent-app.js";
import { lessonNotes } from "./lesson-notes.js";

async function main() {
  const prompt = process.argv.slice(2).join(" ").trim();

  if (!prompt) {
    console.log("Usage:");
    console.log('  npm start -- "查找 src 里 tool 相关的内容"');
    console.log('  npm start -- "请把 hello world 写入 notes.txt"');
    console.log('  npm start -- "运行 `pwd`"');
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

  const result = await app.run(prompt);
  console.log(result.output);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
