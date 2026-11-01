import { describe, it } from "node:test";
import assert from "node:assert/strict";
import {
  addIssueComment,
  createBranch,
  createIssue,
  createOrUpdateFile,
  createPullRequest,
  createRepository,
  forkRepository,
  getFileContents,
  getIssue,
  listIssues,
  listPullRequests,
  pushFiles,
  searchCode,
  searchRepositories,
  tokenFromEnv,
} from "../src/github.js";
import type { FetchFn, HttpResponse } from "../src/types.js";

interface Recorded {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: unknown;
}

/** Fake fetch: responds from a queue of [matcher, payload] steps. */
function fakeFetch(steps: Array<{ match: string; payload: unknown; status?: number }>) {
  const calls: Recorded[] = [];
  const fn: FetchFn = async (url, init) => {
    const body = init?.body ? JSON.parse(init.body) : undefined;
    calls.push({ url, method: init?.method ?? "GET", headers: init?.headers ?? {}, body });
    const step = steps.find((s) => url.includes(s.match)) ?? { match: "", payload: {} };
    const res: HttpResponse = {
      ok: (step.status ?? 200) < 300,
      status: step.status ?? 200,
      headers: { get: () => null },
      text: async () => JSON.stringify(step.payload),
    };
    return res;
  };
  return { fn, calls };
}

const BASE = "https://api.github.com";
const TOKEN = "test-token";

describe("codehost-port core", () => {
  it("names the env var when the token is missing", () => {
    assert.throws(() => tokenFromEnv({}), /GITHUB_PERSONAL_ACCESS_TOKEN/);
    assert.equal(tokenFromEnv({ GITHUB_PERSONAL_ACCESS_TOKEN: " x " }), "x");
  });

  it("create_repository posts to /user/repos with Bearer auth", async () => {
    const { fn, calls } = fakeFetch([{ match: "/user/repos", payload: { id: 1 } }]);
    const out = (await createRepository(fn, TOKEN, BASE, { name: "demo", private: true })) as Record<string, unknown>;
    assert.equal(out.id, 1);
    assert.equal(calls[0].method, "POST");
    assert.equal(calls[0].url, "https://api.github.com/user/repos");
    assert.equal(calls[0].headers.Authorization, "Bearer test-token");
    assert.deepEqual(calls[0].body, { name: "demo", private: true });
  });

  it("fork_repository posts to the forks endpoint", async () => {
    const { fn, calls } = fakeFetch([{ match: "/forks", payload: { id: 2 } }]);
    await forkRepository(fn, TOKEN, BASE, { owner: "octo", repo: "demo" });
    assert.equal(calls[0].url, "https://api.github.com/repos/octo/demo/forks");
    assert.equal(calls[0].method, "POST");
  });

  it("create_branch resolves the base ref then creates the ref", async () => {
    const { fn, calls } = fakeFetch([
      { match: "/git/ref/heads/main", payload: { object: { sha: "abc123" } } },
      { match: "/git/refs", payload: { ref: "refs/heads/feat" } },
    ]);
    const out = (await createBranch(fn, TOKEN, BASE, { owner: "o", repo: "r", branch: "feat", from_branch: "main" })) as Record<string, unknown>;
    assert.equal(out.ref, "refs/heads/feat");
    assert.equal(calls.length, 2);
    assert.deepEqual(calls[1].body, { ref: "refs/heads/feat", sha: "abc123" });
  });

  it("get_file_contents decodes base64 file payloads", async () => {
    const content = Buffer.from("hello world", "utf-8").toString("base64");
    const { fn, calls } = fakeFetch([{ match: "/contents/", payload: { type: "file", encoding: "base64", content } }]);
    const out = await getFileContents(fn, TOKEN, BASE, { owner: "o", repo: "r", path: "docs/a.md", branch: "dev" });
    assert.equal(out, "hello world");
    assert.ok(calls[0].url.endsWith("/contents/docs/a.md?ref=dev"));
  });

  it("create_or_update_file base64-encodes content in a PUT", async () => {
    const { fn, calls } = fakeFetch([{ match: "/contents/", payload: { commit: { sha: "s" } } }]);
    await createOrUpdateFile(fn, TOKEN, BASE, { owner: "o", repo: "r", path: "a.txt", content: "hi", message: "msg", branch: "main" });
    assert.equal(calls[0].method, "PUT");
    assert.equal((calls[0].body as Record<string, unknown>).content, Buffer.from("hi").toString("base64"));
    assert.equal((calls[0].body as Record<string, unknown>).branch, "main");
  });

  it("push_files runs the ref/commit/tree/commit/ref sequence", async () => {
    const { fn, calls } = fakeFetch([
      { match: "/git/ref/heads/main", payload: { object: { sha: "head1" } } },
      { match: "/git/commits/head1", payload: { tree: { sha: "tree1" } } },
      { match: "/git/trees", payload: { sha: "tree2" } },
      { match: "/git/commits", payload: { sha: "commit2" } },
      { match: "/git/refs/heads/main", payload: { ref: "refs/heads/main" } },
    ]);
    await pushFiles(fn, TOKEN, BASE, { owner: "o", repo: "r", branch: "main", message: "m", files: [{ path: "a.txt", content: "x" }] });
    assert.deepEqual(calls.map((c) => c.method), ["GET", "GET", "POST", "POST", "PATCH"]);
    const treeBody = calls[2].body as Record<string, unknown>;
    assert.equal(treeBody.base_tree, "tree1");
    assert.deepEqual(treeBody.tree, [{ path: "a.txt", mode: "100644", type: "blob", content: "x" }]);
    assert.deepEqual(calls[4].body, { sha: "commit2" });
  });

  it("search_repositories shapes the search query", async () => {
    const { fn, calls } = fakeFetch([{ match: "/search/repositories", payload: { total_count: 0 } }]);
    await searchRepositories(fn, TOKEN, BASE, { query: "mcp language:typescript", page: 2, perPage: 5 });
    assert.ok(calls[0].url.includes("q=mcp%20language%3Atypescript"));
    assert.ok(calls[0].url.includes("per_page=5"));
  });

  it("search_code shapes the code search query", async () => {
    const { fn, calls } = fakeFetch([{ match: "/search/code", payload: { total_count: 0 } }]);
    await searchCode(fn, TOKEN, BASE, { q: "addClass in:file" });
    assert.ok(calls[0].url.startsWith("https://api.github.com/search/code?q="));
  });

  it("list_issues and get_issue build repo issue paths", async () => {
    const { fn, calls } = fakeFetch([
      { match: "/issues/7", payload: { number: 7 } },
      { match: "/issues?", payload: [] },
    ]);
    const one = (await getIssue(fn, TOKEN, BASE, { owner: "o", repo: "r", issue_number: 7 })) as Record<string, unknown>;
    assert.equal(one.number, 7);
    await listIssues(fn, TOKEN, BASE, { owner: "o", repo: "r", state: "open", perPage: 3 });
    assert.ok(calls[1].url.includes("state=open"));
    assert.ok(calls[1].url.includes("per_page=3"));
  });

  it("create_issue and add_issue_comment post bodies", async () => {
    const { fn, calls } = fakeFetch([
      { match: "/comments", payload: { id: 9 } },
      { match: "/issues", payload: { number: 3 } },
    ]);
    await createIssue(fn, TOKEN, BASE, { owner: "o", repo: "r", title: "Bug", labels: ["bug"] });
    assert.deepEqual(calls[0].body, { title: "Bug", labels: ["bug"] });
    const c = (await addIssueComment(fn, TOKEN, BASE, { owner: "o", repo: "r", issue_number: 3, body: "hi" })) as Record<string, unknown>;
    assert.equal(c.id, 9);
    assert.ok(calls[1].url.endsWith("/issues/3/comments"));
  });

  it("list_pull_requests and create_pull_request hit /pulls", async () => {
    const { fn, calls } = fakeFetch([{ match: "/pulls", payload: { number: 11 } }]);
    await createPullRequest(fn, TOKEN, BASE, { owner: "o", repo: "r", title: "T", head: "feat", base: "main", draft: true });
    assert.deepEqual(calls[0].body, { title: "T", head: "feat", base: "main", draft: true });
    await listPullRequests(fn, TOKEN, BASE, { owner: "o", repo: "r", state: "closed" });
    assert.ok(calls[1].url.includes("/pulls?state=closed"));
  });

  it("surfaces upstream error messages", async () => {
    const { fn } = fakeFetch([{ match: "/user/repos", payload: { message: "Validation Failed" }, status: 422 }]);
    await assert.rejects(
      () => createRepository(fn, TOKEN, BASE, { name: "x" }),
      /GitHub API error 422: Validation Failed/,
    );
  });
});
