function getLastToolResult(messages) {
  return [...messages].reverse().find((message) => message.role === "tool");
}

function getLastUserText(messages) {
  const lastUser = [...messages].reverse().find((message) => message.role === "user");
  return typeof lastUser?.content === "string" ? lastUser.content : "";
}

function summarizeMarkdownPreview(preview) {
  const headings = [];
  let inCodeBlock = false;

  for (const rawLine of preview.split("\n")) {
    const line = rawLine.trim();

    if (line.startsWith("```")) {
      inCodeBlock = !inCodeBlock;
      continue;
    }

    if (!inCodeBlock && line.startsWith("#")) {
      headings.push(line);
    }

    if (headings.length >= 8) {
      break;
    }
  }

  if (headings.length === 0) {
    return "这个文件没有明显的 Markdown 标题结构，我建议下一步增加更细粒度的文本分析器。";
  }

  return [
    "我从文件标题里提取到的主要结构是：",
    ...headings.map((heading) => `- ${heading.replace(/^#+\s*/, "")}`),
  ].join("\n");
}

export class MockModel {
  async decide({ messages, iteration }) {
    const userText = getLastUserText(messages);
    const lastToolResult = getLastToolResult(messages);

    if (!lastToolResult) {
      if (userText.includes("列出") || userText.toLowerCase().includes("list")) {
        const target = userText.includes("src") ? "src" : ".";
        return {
          type: "tool",
          toolName: "list_files",
          input: { path: target },
        };
      }

      if (userText.includes("阅读") || userText.includes("read") || userText.includes(".md")) {
        const matchedPath =
          userText.match(/([A-Za-z0-9_./-]+\.(md|js|ts|json|rs|py))/)?.[1] ?? "README.md";
        return {
          type: "tool",
          toolName: "read_file",
          input: { path: matchedPath },
        };
      }

      return {
        type: "final",
        output: [
          "这是一个教学版 coding agent。",
          "当前 mock model 只会在“列出文件”或“读取文件”这两类任务上触发工具。",
          "你可以试试：请阅读 rust/README.md 并总结它的架构。",
        ].join("\n"),
      };
    }

    if (iteration >= 2) {
      const payload = lastToolResult.content?.content;

      if (payload?.path && payload?.preview) {
        return {
          type: "final",
          output: [
            `我已经读取了 \`${payload.path}\`。`,
            "",
            summarizeMarkdownPreview(payload.preview),
            "",
            "对应到 coding agent 架构，这一步说明 agent 不只是“回答问题”，而是会先获取上下文，再基于上下文组织回答。",
          ].join("\n"),
        };
      }

      const rendered = JSON.stringify(lastToolResult.content, null, 2);

      return {
        type: "final",
        output: [
          "我已经完成了一轮工具调用。",
          "",
          "工具结果如下：",
          rendered,
          "",
          "从架构角度看，这体现了 coding agent 的核心闭环：先决策，再调用工具，再根据工具结果生成最终回答。",
        ].join("\n"),
      };
    }

    return {
      type: "final",
      output: "本轮没有更多动作。",
    };
  }
}
