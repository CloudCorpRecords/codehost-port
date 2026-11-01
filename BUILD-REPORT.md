# codehost-port — BUILD REPORT

Original: github (@modelcontextprotocol/server-github) → Rebuild: codehost-port
Tier C core subset. Local only, nothing pushed or published.

## Scope
14 tools against the GitHub REST API (https://api.github.com, base
overridable via GITHUB_API_URL), Authorization: Bearer
GITHUB_PERSONAL_ACCESS_TOKEN, all HTTP behind an injectable FetchFn:
create_repository, fork_repository, create_branch, get_file_contents
(base64 file payloads decoded), create_or_update_file (base64-encoded
PUT), push_files (Git Data ref→commit→tree→commit→ref sequence),
search_repositories, search_code, list_issues, get_issue, create_issue,
add_issue_comment, list_pull_requests, create_pull_request.

Omitted groups (fixture `_source` lists them): pull-request detail and
review tools (get_pull_request, files/status/comments/reviews,
create_pull_request_review, merge_pull_request,
update_pull_request_branch), update_issue, search_users/search_issues,
get_commit, branch deletion, release/tag tools — the remaining 12 of
the audited 26-tool surface.

Ground truth: tool count 26 is audited (mcpaudit index,
~/workspace/packages-100/mcp-server-index-external.md, probe-verified);
schemas are docs-derived. Fixture:
harness/fixtures/github-tools-original.json (labelled core-subset).

## Verified (foreground, coordinator, from disk)
- Tools: 14/14 — parity.json identical_tools = 14 = total.
- Unit tests: 13/13 pass (fake FetchFn; URL/method/Bearer/body shaping,
  push_files 5-step sequence, base64 decode/encode, upstream error
  surfacing, missing-token error).
- tsc: exit 0. dist/cli.js present (canonical tsc output).
- Parity: harness/parity.py vs the fixture → PASS, parity_pct 100.0
  (parity-out/parity.json).
- Missing-env stdio check: tools/call search_repositories with
  GITHUB_PERSONAL_ACCESS_TOKEN unset returned isError
  "GITHUB_PERSONAL_ACCESS_TOKEN environment variable is required".
- server.json description 77 chars (≤100); OCI entry has no version
  field; Dockerfile label io.github.CloudCorpRecords/codehost-port;
  full 19-file factory set present.

## Honest gaps
- No live GitHub call was made (no token in this VM, egress blocked) —
  request/response behaviour is fake-fetch proven only.
- push_files always creates blobs with mode 100644 (no executable or
  symlink modes) and does not delete files.
- create_branch without from_branch reads the repo's default_branch
  first (an extra API call vs the original's behaviour).
- Lockfile is a copied fleet lockfile with identity fields edited —
  clean lockfile regeneration is REQUIRED before publish.
- mcpaudit / mcpvet / shipcheck not yet run — pre-publish gate.

Note: an earlier builder report for this build claimed test/parity
numbers that did not exist on disk; this build was completed and every
number above was re-verified in the foreground by the coordinator.
