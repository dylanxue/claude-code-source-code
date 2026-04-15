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

function summarizeTextPreview(preview) {
  const nonEmptyLines = preview
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean);

  return [
    "这个文件更像普通源码或文本，而不是 Markdown 文档。",
    "我截取到的前几行关键信息是：",
    ...nonEmptyLines.slice(0, 5).map((line) => `- ${line}`),
  ].join("\n");
}

function extractPath(text, fallbackPath = ".") {
  return text.match(/([A-Za-z0-9_./-]+(?:\/)?[A-Za-z0-9_.-]*)/)?.[1] ?? fallbackPath;
}

function extractFilePath(text, fallbackPath = "notes.txt") {
  return text.match(/([A-Za-z0-9_./-]+\.(md|txt|js|ts|json|rs|py))/)?.[1] ?? fallbackPath;
}

function extractSearchPattern(text) {
  const quotedPattern = text.match(/["“](.+?)["”]/)?.[1];

  if (quotedPattern) {
    return quotedPattern;
  }

  const keywordPattern = text.match(/(?:查找|搜索|grep|search)\s+([A-Za-z0-9_.-]+)/i)?.[1];
  return keywordPattern ?? "tool";
}

function extractWriteContent(text) {
  const quotedContent = text.match(/["“](.+?)["”]/)?.[1];
  return quotedContent ?? "Lesson 2 generated this file.";
}

function extractUrl(text) {
  return text.match(/https?:\/\/[^\s)]+/i)?.[0] ?? null;
}

function extractToolSearchQuery(text) {
  const quoted = text.match(/["“](.+?)["”]/)?.[1];
  if (quoted) {
    return quoted;
  }

  return text
    .replace(/工具|能力|tool search|toolsearch|tool/gi, " ")
    .trim() || "search";
}

function summarizeSearchFiles(filenames) {
  if (!filenames?.length) {
    return "没有找到匹配结果。";
  }

  return [
    `一共命中 ${filenames.length} 个文件。`,
    ...filenames.slice(0, 5).map((filename) => `- ${filename}`),
  ].join("\n");
}

function summarizeToolResult(lastToolResult) {
  if (!lastToolResult.content?.ok) {
    return [
      `工具 \`${lastToolResult.content.toolName}\` 执行失败。`,
      `错误信息：${lastToolResult.content.error}`,
      "",
      "这也是 coding agent 的关键能力之一：工具失败不能让整个系统失忆，失败结果也要进入会话上下文。",
    ].join("\n");
  }

  const payload = lastToolResult.content.content;

  if (payload?.type === "text" && payload?.file?.filePath && typeof payload?.file?.content === "string") {
    const text = payload.file.content;
    const summary = payload.file.filePath.endsWith(".md")
      ? summarizeMarkdownPreview(text)
      : summarizeTextPreview(text);

    return [
      `我已经读取了 \`${payload.file.filePath}\`。`,
      "",
      summary,
      "",
      "对应到 coding agent 架构，这一步说明 agent 不只是“回答问题”，而是会先获取上下文，再基于上下文组织回答。",
    ].join("\n");
  }

  if (Array.isArray(payload?.filenames)) {
    return [
      `我已经完成了 \`${lastToolResult.content.toolName}\`。`,
      "",
      summarizeSearchFiles(payload.filenames),
      "",
      "这一步对应真实 coding agent 里的检索层：先缩小范围，再决定读哪个文件。",
    ].join("\n");
  }

  if (payload?.filePath && payload?.structuredPatch && (payload?.type === "create" || payload?.type === "update")) {
    return [
      `我已经把内容写入 \`${payload.path}\`。`,
      "",
      `写入类型：${payload.type}`,
      "这一步对应真实 coding agent 的执行层：不仅能分析，还能产生工作产物。",
    ].join("\n");
  }

  if (lastToolResult.content.toolName === "bash") {
    return [
      "我已经执行了一次 shell 命令。",
      "",
      payload.returnCodeInterpretation
        ? `返回结果：${payload.returnCodeInterpretation}`
        : "返回结果：success",
      payload.stdout ? `标准输出预览：\n${payload.stdout}` : "没有标准输出。",
      payload.stderr ? `标准错误预览：\n${payload.stderr}` : "没有标准错误。",
      "",
      "这一步对应 coding agent 的外部执行能力，不过真正产品里通常还会加权限和沙箱。",
    ].join("\n");
  }

  if (lastToolResult.content.toolName === "WebFetch") {
    return [
      `我已经抓取了 \`${payload.url}\`。`,
      "",
      `HTTP 状态：${payload.code} ${payload.codeText}`,
      `抓取耗时：${payload.durationMs} ms`,
      "",
      payload.result,
      "",
      "这一步对应真实 coding agent 里的外部信息入口：当问题超出 workspace 时，不要优先依赖 shell 绕路读取，而要走显式的 WebFetch 工具。",
    ].join("\n");
  }

  if (lastToolResult.content.toolName === "WebSearch") {
    const hits = Array.isArray(payload?.results?.[1]?.content) ? payload.results[1].content : [];
    return [
      `我已经完成了 WebSearch，查询是：\`${payload.query}\`。`,
      "",
      hits.length === 0
        ? "这次没有命中可用的搜索结果。"
        : [
          `命中 ${hits.length} 条结果：`,
          ...hits.slice(0, 5).map((hit) => `- ${hit.title} — ${hit.url}`),
        ].join("\n"),
      "",
      "这一步对应真实 coding agent 的外部知识通道：需要当前信息或 workspace 外事实时，优先走 WebSearch，再基于结果决定是否继续抓取具体页面。",
    ].join("\n");
  }

  if (lastToolResult.content.toolName === "ToolSearch") {
    const matches = Array.isArray(payload?.matches) ? payload.matches : [];
    return [
      `我已经完成了 ToolSearch，查询是：\`${payload.query}\`。`,
      "",
      matches.length === 0
        ? "这次没有找到明显匹配的工具。"
        : [
          `最匹配的 ${matches.length} 个工具：`,
          ...matches.map((name) => `- ${name}`),
        ].join("\n"),
      "",
      "这一步对应真实 coding agent 的能力发现层：当工具面越来越大时，模型不该只靠记忆工具名，而应该先检索当前可用能力。",
    ].join("\n");
  }

  return [
    "我已经完成了一轮工具调用。",
    "",
    "工具结果如下：",
    JSON.stringify(lastToolResult.content, null, 2),
    "",
    "从架构角度看，这体现了 coding agent 的核心闭环：先决策，再调用工具，再根据工具结果生成最终回答。",
  ].join("\n");
}

export class MockModel {
  async decide({ messages, iteration }) {
    const userText = getLastUserText(messages);
    const lastToolResult = getLastToolResult(messages);

    if (!lastToolResult) {
      if (
        userText.includes("什么工具") ||
        userText.includes("有哪些工具") ||
        userText.includes("用什么能力") ||
        userText.toLowerCase().includes("tool search") ||
        userText.toLowerCase().includes("which tool")
      ) {
        return {
          type: "tool",
          toolName: "ToolSearch",
          input: {
            query: extractToolSearchQuery(userText),
          },
        };
      }

      const directUrl = extractUrl(userText);
      if (directUrl) {
        return {
          type: "tool",
          toolName: "WebFetch",
          input: {
            url: directUrl,
            prompt: /标题|title/i.test(userText)
              ? "Extract the title from this page."
              : "Summarize the main content of this page.",
          },
        };
      }

      if (
        userText.includes("搜索网络") ||
        userText.includes("网上") ||
        userText.includes("最新") ||
        userText.includes("新闻") ||
        userText.toLowerCase().includes("web search") ||
        userText.toLowerCase().includes("search the web")
      ) {
        return {
          type: "tool",
          toolName: "WebSearch",
          input: {
            query: userText,
          },
        };
      }

      if (
        userText.includes("抓取网页") ||
        userText.includes("网页内容") ||
        userText.toLowerCase().includes("web fetch")
      ) {
        return {
          type: "tool",
          toolName: "WebFetch",
          input: {
            url: "https://example.com",
            prompt: "Summarize the main content of this page.",
          },
        };
      }

      if (userText.includes("写入") || userText.includes("创建文件") || userText.toLowerCase().includes("write")) {
        return {
          type: "tool",
          toolName: "write_file",
          input: {
            path: extractFilePath(userText, "lesson2-output.txt"),
            content: extractWriteContent(userText),
          },
        };
      }

      if (userText.includes("运行") || userText.includes("执行命令") || userText.toLowerCase().includes("bash")) {
        const command = userText.match(/`([^`]+)`/)?.[1] ?? "pwd";
        return {
          type: "tool",
          toolName: "bash",
          input: { command },
        };
      }

      if (userText.includes("查找") || userText.includes("搜索") || userText.toLowerCase().includes("grep")) {
        return {
          type: "tool",
          toolName: "grep_search",
          input: {
            pattern: extractSearchPattern(userText),
            path: userText.includes("src") ? "src" : ".",
          },
        };
      }

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
      if (
        ["grep_text", "grep_search"].includes(lastToolResult.content?.toolName) &&
        lastToolResult.content?.ok &&
        lastToolResult.content?.content?.filenames?.length &&
        (userText.includes("阅读") || userText.includes("总结") || userText.toLowerCase().includes("read"))
      ) {
        const firstMatch = lastToolResult.content.content.filenames[0];
        return {
          type: "tool",
          toolName: "read_file",
          input: { path: firstMatch },
        };
      }

      return {
        type: "final",
        output: summarizeToolResult(lastToolResult),
      };
    }

    return {
      type: "final",
      output: "本轮没有更多动作。",
    };
  }
}
