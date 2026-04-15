import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import { resolveWorkspaceScopedDclawChildPath } from "../config/dclaw-paths.js";

function timestampId() {
  return `${Date.now()}-${Math.random().toString(16).slice(2, 10)}`;
}

function slugify(value) {
  return String(value ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function createAgentId() {
  return `agent-${timestampId()}`;
}

export function normalizeAgentName(name, fallback = "agent-task") {
  return slugify(name) || slugify(fallback) || "agent-task";
}

export function ensureAgentArtifactPaths(workspaceRoot, agentId) {
  const agentDir = resolveWorkspaceScopedDclawChildPath(workspaceRoot, "agents", agentId);
  mkdirSync(agentDir, { recursive: true });

  return {
    agentDir,
    manifestFile: path.join(agentDir, "manifest.json"),
    outputFile: path.join(agentDir, "output.md"),
    sessionFile: path.join(agentDir, "session.json"),
  };
}

export function saveAgentManifest(manifest) {
  mkdirSync(path.dirname(manifest.manifestFile), { recursive: true });
  writeFileSync(manifest.manifestFile, JSON.stringify(manifest, null, 2), "utf8");
  return manifest.manifestFile;
}

export function saveAgentOutput(outputFile, output = "") {
  mkdirSync(path.dirname(outputFile), { recursive: true });
  writeFileSync(outputFile, String(output ?? ""), "utf8");
  return outputFile;
}

export function saveAgentSession(sessionFile, session) {
  mkdirSync(path.dirname(sessionFile), { recursive: true });
  writeFileSync(sessionFile, JSON.stringify(session.toJSON(), null, 2), "utf8");
  return sessionFile;
}

