/**
 * codehost-port core: a 14-tool core subset of the GitHub reference MCP
 * server surface, implemented clean-room against the public GitHub
 * REST API (https://api.github.com, base overridable via GITHUB_API_URL).
 *
 * Auth: GITHUB_PERSONAL_ACCESS_TOKEN, sent as `Authorization: Bearer`.
 * A missing token is an error naming the variable, matching the
 * original's fail-fast behaviour. All HTTP goes through an injected
 * FetchFn so the wire behaviour is fully testable offline.
 */
import type {
  AddIssueCommentOptions,
  CreateBranchOptions,
  CreateIssueOptions,
  CreateOrUpdateFileOptions,
  CreatePullRequestOptions,
  CreateRepositoryOptions,
  FetchFn,
  ForkRepositoryOptions,
  GetFileContentsOptions,
  GetIssueOptions,
  ListIssuesOptions,
  ListPullRequestsOptions,
  PushFilesOptions,
  SearchCodeOptions,
  SearchRepositoriesOptions,
} from "./types.js";

export const VERSION = "0.1.0";

export const DEFAULT_API_BASE = "https://api.github.com";

export function tokenFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.GITHUB_PERSONAL_ACCESS_TOKEN;
  const token = typeof raw === "string" ? raw.trim() : "";
  if (!token) {
    throw new Error(
      "GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required",
    );
  }
  return token;
}

export function apiBaseFromEnv(
  env: Record<string, string | undefined> = process.env,
): string {
  const raw = env.GITHUB_API_URL;
  const base = typeof raw === "string" ? raw.trim() : "";
  return (base || DEFAULT_API_BASE).replace(/\/+$/, "");
}

interface RequestSpec {
  method: string;
  path: string;
  body?: unknown;
}

async function ghRequest(
  fetchFn: FetchFn,
  token: string,
  base: string,
  spec: RequestSpec,
): Promise<unknown> {
  const res = await fetchFn(`${base}${spec.path}`, {
    method: spec.method,
    headers: {
      Authorization: `Bearer ${token}`,
      Accept: "application/vnd.github+json",
      "Content-Type": "application/json",
      "X-GitHub-Api-Version": "2022-11-28",
    },
    body: spec.body === undefined ? undefined : JSON.stringify(spec.body),
  });
  const text = await res.text();
  if (!res.ok) {
    let detail = text;
    try {
      const parsed = JSON.parse(text) as Record<string, unknown>;
      if (typeof parsed.message === "string") detail = parsed.message;
    } catch {
      // Keep the raw body as the detail.
    }
    throw new Error(`GitHub API error ${res.status}: ${detail}`);
  }
  if (!text) return { status: res.status };
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return text;
  }
}

function query(params: Record<string, string | number | undefined>): string {
  const parts: string[] = [];
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined) {
      parts.push(`${encodeURIComponent(key)}=${encodeURIComponent(String(value))}`);
    }
  }
  return parts.length ? `?${parts.join("&")}` : "";
}

const enc = encodeURIComponent;

export async function createRepository(
  fetchFn: FetchFn, token: string, base: string, opts: CreateRepositoryOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "POST",
    path: "/user/repos",
    body: {
      name: opts.name,
      description: opts.description,
      private: opts.private,
      auto_init: opts.autoInit,
    },
  });
}

export async function forkRepository(
  fetchFn: FetchFn, token: string, base: string, opts: ForkRepositoryOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/forks`,
    body: {},
  });
}

export async function createBranch(
  fetchFn: FetchFn, token: string, base: string, opts: CreateBranchOptions,
): Promise<unknown> {
  let from = opts.from_branch;
  if (!from) {
    const repo = (await ghRequest(fetchFn, token, base, {
      method: "GET",
      path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}`,
    })) as Record<string, unknown>;
    from = typeof repo.default_branch === "string" ? repo.default_branch : "main";
  }
  const ref = (await ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/git/ref/heads/${enc(from)}`,
  })) as Record<string, unknown>;
  const obj = ref.object as Record<string, unknown> | undefined;
  const sha = obj && typeof obj.sha === "string" ? obj.sha : undefined;
  if (!sha) throw new Error(`Could not resolve ref heads/${from} to a commit sha`);
  return ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/git/refs`,
    body: { ref: `refs/heads/${opts.branch}`, sha },
  });
}

export async function getFileContents(
  fetchFn: FetchFn, token: string, base: string, opts: GetFileContentsOptions,
): Promise<unknown> {
  const data = await ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/contents/${opts.path
      .split("/")
      .map(enc)
      .join("/")}${query({ ref: opts.branch })}`,
  });
  if (data !== null && typeof data === "object" && !Array.isArray(data)) {
    const file = data as Record<string, unknown>;
    if (file.type === "file" && file.encoding === "base64" && typeof file.content === "string") {
      return Buffer.from(file.content, "base64").toString("utf-8");
    }
  }
  return data;
}

export async function createOrUpdateFile(
  fetchFn: FetchFn, token: string, base: string, opts: CreateOrUpdateFileOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "PUT",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/contents/${opts.path
      .split("/")
      .map(enc)
      .join("/")}`,
    body: {
      message: opts.message,
      content: Buffer.from(opts.content, "utf-8").toString("base64"),
      branch: opts.branch,
      sha: opts.sha,
    },
  });
}

export async function pushFiles(
  fetchFn: FetchFn, token: string, base: string, opts: PushFilesOptions,
): Promise<unknown> {
  const repoPath = `/repos/${enc(opts.owner)}/${enc(opts.repo)}`;
  const ref = (await ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `${repoPath}/git/ref/heads/${enc(opts.branch)}`,
  })) as Record<string, unknown>;
  const refObj = ref.object as Record<string, unknown>;
  const headSha = refObj.sha as string;
  const commit = (await ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `${repoPath}/git/commits/${headSha}`,
  })) as Record<string, unknown>;
  const baseTree = (commit.tree as Record<string, unknown>).sha as string;
  const tree = (await ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `${repoPath}/git/trees`,
    body: {
      base_tree: baseTree,
      tree: opts.files.map((f) => ({
        path: f.path,
        mode: "100644",
        type: "blob",
        content: f.content,
      })),
    },
  })) as Record<string, unknown>;
  const newCommit = (await ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `${repoPath}/git/commits`,
    body: { message: opts.message, tree: tree.sha, parents: [headSha] },
  })) as Record<string, unknown>;
  return ghRequest(fetchFn, token, base, {
    method: "PATCH",
    path: `${repoPath}/git/refs/heads/${enc(opts.branch)}`,
    body: { sha: newCommit.sha },
  });
}

export async function searchRepositories(
  fetchFn: FetchFn, token: string, base: string, opts: SearchRepositoriesOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/search/repositories${query({ q: opts.query, page: opts.page, per_page: opts.perPage })}`,
  });
}

export async function searchCode(
  fetchFn: FetchFn, token: string, base: string, opts: SearchCodeOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/search/code${query({ q: opts.q, page: opts.page, per_page: opts.perPage })}`,
  });
}

export async function listIssues(
  fetchFn: FetchFn, token: string, base: string, opts: ListIssuesOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/issues${query({
      state: opts.state,
      labels: opts.labels,
      per_page: opts.perPage,
      page: opts.page,
    })}`,
  });
}

export async function getIssue(
  fetchFn: FetchFn, token: string, base: string, opts: GetIssueOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/issues/${opts.issue_number}`,
  });
}

export async function createIssue(
  fetchFn: FetchFn, token: string, base: string, opts: CreateIssueOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/issues`,
    body: {
      title: opts.title,
      body: opts.body,
      assignees: opts.assignees,
      labels: opts.labels,
    },
  });
}

export async function addIssueComment(
  fetchFn: FetchFn, token: string, base: string, opts: AddIssueCommentOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/issues/${opts.issue_number}/comments`,
    body: { body: opts.body },
  });
}

export async function listPullRequests(
  fetchFn: FetchFn, token: string, base: string, opts: ListPullRequestsOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "GET",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/pulls${query({
      state: opts.state,
      per_page: opts.perPage,
      page: opts.page,
    })}`,
  });
}

export async function createPullRequest(
  fetchFn: FetchFn, token: string, base: string, opts: CreatePullRequestOptions,
): Promise<unknown> {
  return ghRequest(fetchFn, token, base, {
    method: "POST",
    path: `/repos/${enc(opts.owner)}/${enc(opts.repo)}/pulls`,
    body: {
      title: opts.title,
      body: opts.body,
      head: opts.head,
      base: opts.base,
      draft: opts.draft,
    },
  });
}

/** Dispatch a tool call by name. Used by both the MCP server and the CLI. */
export async function callTool(
  fetchFn: FetchFn,
  token: string,
  base: string,
  name: string,
  args: Record<string, unknown>,
): Promise<unknown> {
  switch (name) {
    case "create_repository":
      return createRepository(fetchFn, token, base, args as unknown as CreateRepositoryOptions);
    case "fork_repository":
      return forkRepository(fetchFn, token, base, args as unknown as ForkRepositoryOptions);
    case "create_branch":
      return createBranch(fetchFn, token, base, args as unknown as CreateBranchOptions);
    case "get_file_contents":
      return getFileContents(fetchFn, token, base, args as unknown as GetFileContentsOptions);
    case "create_or_update_file":
      return createOrUpdateFile(fetchFn, token, base, args as unknown as CreateOrUpdateFileOptions);
    case "push_files":
      return pushFiles(fetchFn, token, base, args as unknown as PushFilesOptions);
    case "search_repositories":
      return searchRepositories(fetchFn, token, base, args as unknown as SearchRepositoriesOptions);
    case "search_code":
      return searchCode(fetchFn, token, base, args as unknown as SearchCodeOptions);
    case "list_issues":
      return listIssues(fetchFn, token, base, args as unknown as ListIssuesOptions);
    case "get_issue":
      return getIssue(fetchFn, token, base, args as unknown as GetIssueOptions);
    case "create_issue":
      return createIssue(fetchFn, token, base, args as unknown as CreateIssueOptions);
    case "add_issue_comment":
      return addIssueComment(fetchFn, token, base, args as unknown as AddIssueCommentOptions);
    case "list_pull_requests":
      return listPullRequests(fetchFn, token, base, args as unknown as ListPullRequestsOptions);
    case "create_pull_request":
      return createPullRequest(fetchFn, token, base, args as unknown as CreatePullRequestOptions);
    default:
      throw new Error(`Unknown tool: ${name}`);
  }
}
