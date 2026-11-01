/**
 * codehost-port types.
 *
 * A core subset of the GitHub reference MCP server surface: repository,
 * issue and pull-request operations against the GitHub REST API. HTTP
 * access is described by a minimal response surface so tests can inject
 * a fake fetch.
 */

export interface HttpResponse {
  ok: boolean;
  status: number;
  statusText?: string;
  headers: { get(name: string): string | null };
  text(): Promise<string>;
}

export type FetchFn = (
  url: string,
  init?: {
    method?: string;
    headers?: Record<string, string>;
    body?: string;
    redirect?: string;
  },
) => Promise<HttpResponse>;

export interface CreateRepositoryOptions {
  name: string;
  description?: string;
  private?: boolean;
  autoInit?: boolean;
}

export interface ForkRepositoryOptions {
  owner: string;
  repo: string;
}

export interface CreateBranchOptions {
  owner: string;
  repo: string;
  branch: string;
  from_branch?: string;
}

export interface GetFileContentsOptions {
  owner: string;
  repo: string;
  path: string;
  branch?: string;
}

export interface CreateOrUpdateFileOptions {
  owner: string;
  repo: string;
  path: string;
  content: string;
  message: string;
  branch: string;
  sha?: string;
}

export interface PushFileEntry {
  path: string;
  content: string;
}

export interface PushFilesOptions {
  owner: string;
  repo: string;
  branch: string;
  files: PushFileEntry[];
  message: string;
}

export interface SearchRepositoriesOptions {
  query: string;
  page?: number;
  perPage?: number;
}

export interface SearchCodeOptions {
  q: string;
  page?: number;
  perPage?: number;
}

export interface ListIssuesOptions {
  owner: string;
  repo: string;
  state?: string;
  labels?: string;
  perPage?: number;
  page?: number;
}

export interface GetIssueOptions {
  owner: string;
  repo: string;
  issue_number: number;
}

export interface CreateIssueOptions {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  assignees?: string[];
  labels?: string[];
}

export interface AddIssueCommentOptions {
  owner: string;
  repo: string;
  issue_number: number;
  body: string;
}

export interface ListPullRequestsOptions {
  owner: string;
  repo: string;
  state?: string;
  perPage?: number;
  page?: number;
}

export interface CreatePullRequestOptions {
  owner: string;
  repo: string;
  title: string;
  body?: string;
  head: string;
  base: string;
  draft?: boolean;
}
