#!/usr/bin/env node
/**
 * codehost-port CLI.
 *   codehost-port <tool-name> '<json args>'
 *   codehost-port mcp
 * Requires GITHUB_PERSONAL_ACCESS_TOKEN. Exit codes: 0 success, 1 error, 2 usage.
 */
import { apiBaseFromEnv, callTool, tokenFromEnv, VERSION } from "./github.js";
import type { FetchFn } from "./types.js";

const TOOL_NAMES = [
  "create_repository", "fork_repository", "create_branch", "get_file_contents",
  "create_or_update_file", "push_files", "search_repositories", "search_code",
  "list_issues", "get_issue", "create_issue", "add_issue_comment",
  "list_pull_requests", "create_pull_request",
];

function usage(): never {
  console.error(`Usage:
  codehost-port <tool> '<json args>'   tools: ${TOOL_NAMES.join(", ")}
  codehost-port mcp
  codehost-port --version`);
  process.exit(2);
}

async function main(): Promise<void> {
  const [cmd, ...rest] = process.argv.slice(2);
  if (cmd === "--version" || cmd === "-v") { console.log(VERSION); return; }
  if (cmd === "mcp") { await import("./mcp.js"); return; }
  if (!cmd || !TOOL_NAMES.includes(cmd)) usage();
  let args: Record<string, unknown> = {};
  const raw = rest.join(" ").trim();
  if (raw) {
    try {
      args = JSON.parse(raw) as Record<string, unknown>;
    } catch {
      console.error("error: args must be a JSON object");
      process.exit(1);
    }
  }
  try {
    const fetchFn = globalThis.fetch as unknown as FetchFn;
    const out = await callTool(fetchFn, tokenFromEnv(), apiBaseFromEnv(), cmd, args);
    console.log(typeof out === "string" ? out : JSON.stringify(out, null, 2));
  } catch (err) {
    console.error(`error: ${err instanceof Error ? err.message : String(err)}`);
    process.exit(1);
  }
}
void main();
