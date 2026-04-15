import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

function parseEnvFile(content) {
  for (const rawLine of content.split("\n")) {
    const line = rawLine.trim();

    if (!line || line.startsWith("#")) {
      continue;
    }

    const separatorIndex = line.indexOf("=");

    if (separatorIndex === -1) {
      continue;
    }

    const key = line.slice(0, separatorIndex).trim();
    const value = line.slice(separatorIndex + 1).trim();

    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

export function loadLocalEnv(workspaceRoot = process.cwd()) {
  const envPath = path.resolve(workspaceRoot, ".env.local");

  if (!existsSync(envPath)) {
    return;
  }

  parseEnvFile(readFileSync(envPath, "utf8"));
}
