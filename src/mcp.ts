/**
 * codehost-port MCP server. Core subset: 14 tools.
 *
 * Low-level Server API with explicit inputSchema literals (the
 * McpServer+zod path injects $schema/additionalProperties and breaks
 * parity). Zod still validates call args. The literals match the
 * labelled core-subset fixture exactly.
 */
import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import {
  CallToolRequestSchema,
  ErrorCode,
  ListToolsRequestSchema,
  McpError,
} from "@modelcontextprotocol/sdk/types.js";
import { z } from "zod";
import { apiBaseFromEnv, callTool, tokenFromEnv, VERSION } from "./github.js";
import type { FetchFn } from "./types.js";

const OwnerRepo = { owner: z.string(), repo: z.string() };
const ARG_SCHEMAS: Record<string, z.ZodTypeAny> = {
  create_repository: z.object({
    name: z.string(), description: z.string().optional(),
    private: z.boolean().optional(), autoInit: z.boolean().optional(),
  }),
  fork_repository: z.object({ ...OwnerRepo }),
  create_branch: z.object({
    ...OwnerRepo, branch: z.string(), from_branch: z.string().optional(),
  }),
  get_file_contents: z.object({
    ...OwnerRepo, path: z.string(), branch: z.string().optional(),
  }),
  create_or_update_file: z.object({
    ...OwnerRepo, path: z.string(), content: z.string(), message: z.string(),
    branch: z.string(), sha: z.string().optional(),
  }),
  push_files: z.object({
    ...OwnerRepo, branch: z.string(),
    files: z.array(z.object({ path: z.string(), content: z.string() })),
    message: z.string(),
  }),
  search_repositories: z.object({
    query: z.string(), page: z.number().optional(), perPage: z.number().optional(),
  }),
  search_code: z.object({
    q: z.string(), page: z.number().optional(), perPage: z.number().optional(),
  }),
  list_issues: z.object({
    ...OwnerRepo, state: z.string().optional(), labels: z.string().optional(),
    perPage: z.number().optional(), page: z.number().optional(),
  }),
  get_issue: z.object({ ...OwnerRepo, issue_number: z.number() }),
  create_issue: z.object({
    ...OwnerRepo, title: z.string(), body: z.string().optional(),
    assignees: z.array(z.string()).optional(), labels: z.array(z.string()).optional(),
  }),
  add_issue_comment: z.object({
    ...OwnerRepo, issue_number: z.number(), body: z.string(),
  }),
  list_pull_requests: z.object({
    ...OwnerRepo, state: z.string().optional(),
    perPage: z.number().optional(), page: z.number().optional(),
  }),
  create_pull_request: z.object({
    ...OwnerRepo, title: z.string(), body: z.string().optional(),
    head: z.string(), base: z.string(), draft: z.boolean().optional(),
  }),
};

export const TOOLS = [
  {
    name: "create_repository",
    description: "Create a new GitHub repository for the authenticated user.",
    inputSchema: {
      type: "object" as const,
      properties: {
        name: { type: "string", description: "The name of the new repository." },
        description: { type: "string", description: "A description of the new repository." },
        private: { type: "boolean", description: "Whether the new repository should be private." },
        autoInit: { type: "boolean", description: "Whether to initialize the new repository with a README file." },
      },
      required: ["name"],
    },
  },
  {
    name: "fork_repository",
    description: "Fork a GitHub repository into the authenticated user's account.",
    inputSchema: {
      type: "object" as const,
      properties: { owner: { type: "string", description: "The owner of the repository to fork." }, repo: { type: "string", description: "The name of the repository to fork." } },
      required: ["owner", "repo"],
    },
  },
  {
    name: "create_branch",
    description: "Create a new branch in a repository, optionally from another branch.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to create the branch in." }, repo: { type: "string", description: "The name of the repository to create the branch in." },
        branch: { type: "string", description: "The name of the new branch to create." }, from_branch: { type: "string", description: "The name of the branch to create the new branch from; defaults to the repository's default branch." },
      },
      required: ["owner", "repo", "branch"],
    },
  },
  {
    name: "get_file_contents",
    description: "Get the contents of a file or directory from a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to get file contents from." }, repo: { type: "string", description: "The name of the repository to get file contents from." },
        path: { type: "string", description: "The path to the file or directory in the repository." }, branch: { type: "string", description: "The branch to get the file contents from." },
      },
      required: ["owner", "repo", "path"],
    },
  },
  {
    name: "create_or_update_file",
    description: "Create or update a single file in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository containing the file." }, repo: { type: "string", description: "The name of the repository containing the file." },
        path: { type: "string", description: "The path to the file in the repository." }, content: { type: "string", description: "The new content of the file." },
        message: { type: "string", description: "The commit message for the file creation or update." }, branch: { type: "string", description: "The branch to create or update the file on." },
        sha: { type: "string", description: "The blob SHA of the file being replaced, required when updating an existing file." },
      },
      required: ["owner", "repo", "path", "content", "message", "branch"],
    },
  },
  {
    name: "push_files",
    description: "Push one or more files to a GitHub repository in a single commit.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to push files to." }, repo: { type: "string", description: "The name of the repository to push files to." },
        branch: { type: "string", description: "The branch to push the files to." },
        files: {
          type: "array",
          description: "The files to push, each with its path and content.",
          items: {
            type: "object",
            properties: { path: { type: "string", description: "The path of the file in the repository." }, content: { type: "string", description: "The content of the file." } },
            required: ["path", "content"],
          },
        },
        message: { type: "string", description: "The commit message for the push." },
      },
      required: ["owner", "repo", "branch", "files", "message"],
    },
  },
  {
    name: "search_repositories",
    description: "Search for GitHub repositories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        query: { type: "string", description: "The search query for repositories." }, page: { type: "number", description: "The page number of results to return." }, perPage: { type: "number", description: "The maximum number of results to return per page." },
      },
      required: ["query"],
    },
  },
  {
    name: "search_code",
    description: "Search for code across GitHub repositories.",
    inputSchema: {
      type: "object" as const,
      properties: {
        q: { type: "string", description: "The search query for code." }, page: { type: "number", description: "The page number of results to return." }, perPage: { type: "number", description: "The maximum number of results to return per page." },
      },
      required: ["q"],
    },
  },
  {
    name: "list_issues",
    description: "List issues in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to list issues in." }, repo: { type: "string", description: "The name of the repository to list issues in." },
        state: { type: "string", description: "Filter issues by state, such as 'open' or 'closed'." }, labels: { type: "string", description: "Filter issues by label names, as a comma-separated string." },
        perPage: { type: "number", description: "The maximum number of issues to return per page." }, page: { type: "number", description: "The page number of issue results to return." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "get_issue",
    description: "Get the details of a specific issue in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository containing the issue." }, repo: { type: "string", description: "The name of the repository containing the issue." },
        issue_number: { type: "number", description: "The number of the issue to retrieve." },
      },
      required: ["owner", "repo", "issue_number"],
    },
  },
  {
    name: "create_issue",
    description: "Create a new issue in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to create the issue in." }, repo: { type: "string", description: "The name of the repository to create the issue in." },
        title: { type: "string", description: "The title of the new issue." }, body: { type: "string", description: "The body text of the new issue." },
        assignees: { type: "array", items: { type: "string" }, description: "The usernames to assign to the new issue." },
        labels: { type: "array", items: { type: "string" }, description: "The label names to add to the new issue." },
      },
      required: ["owner", "repo", "title"],
    },
  },
  {
    name: "add_issue_comment",
    description: "Add a comment to an existing issue in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository containing the issue to comment on." }, repo: { type: "string", description: "The name of the repository containing the issue to comment on." },
        issue_number: { type: "number", description: "The number of the issue to add the comment to." }, body: { type: "string", description: "The text of the comment to add." },
      },
      required: ["owner", "repo", "issue_number", "body"],
    },
  },
  {
    name: "list_pull_requests",
    description: "List pull requests in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to list pull requests in." }, repo: { type: "string", description: "The name of the repository to list pull requests in." },
        state: { type: "string", description: "Filter pull requests by state, such as 'open' or 'closed'." }, perPage: { type: "number", description: "The maximum number of pull requests to return per page." }, page: { type: "number", description: "The page number of pull request results to return." },
      },
      required: ["owner", "repo"],
    },
  },
  {
    name: "create_pull_request",
    description: "Create a new pull request in a GitHub repository.",
    inputSchema: {
      type: "object" as const,
      properties: {
        owner: { type: "string", description: "The owner of the repository to create the pull request in." }, repo: { type: "string", description: "The name of the repository to create the pull request in." },
        title: { type: "string", description: "The title of the new pull request." }, body: { type: "string", description: "The body text of the new pull request." },
        head: { type: "string", description: "The name of the branch to merge from (the source branch)." }, base: { type: "string", description: "The name of the branch to merge into (the target branch)." },
        draft: { type: "boolean", description: "Whether to create the pull request as a draft." },
      },
      required: ["owner", "repo", "title", "head", "base"],
    },
  },
];

function textResult(value: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: typeof value === "string" ? value : JSON.stringify(value, null, 2),
    }],
  };
}
function errorResult(err: unknown) {
  return {
    content: [{
      type: "text" as const,
      text: err instanceof Error ? err.message : String(err),
    }],
    isError: true,
  };
}

const server = new Server(
  { name: "codehost-port", version: VERSION },
  { capabilities: { tools: {} } },
);
server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: TOOLS }));
server.setRequestHandler(CallToolRequestSchema, async (request) => {
  const { name, arguments: args } = request.params;
  const schema = ARG_SCHEMAS[name];
  if (!schema) throw new McpError(ErrorCode.MethodNotFound, `Unknown tool: ${name}`);
  try {
    const token = tokenFromEnv();
    const parsed = schema.parse(args ?? {}) as Record<string, unknown>;
    const fetchFn = globalThis.fetch as unknown as FetchFn;
    return textResult(await callTool(fetchFn, token, apiBaseFromEnv(), name, parsed));
  } catch (err) {
    return errorResult(err);
  }
});

async function main(): Promise<void> {
  await server.connect(new StdioServerTransport());
}
void main();
