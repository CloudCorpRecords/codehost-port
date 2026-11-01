# codehost-port

GitHub repositories, issues and pull requests as MCP tools, talking to the
GitHub REST API. codehost-port is a clean-room rebuild of the core surface
of the GitHub reference MCP server, under a new name: the same tool names
and wire behaviour, fresh code, no copied branding.

## Tools (core subset, 14)

`create_repository`, `fork_repository`, `create_branch`,
`get_file_contents`, `create_or_update_file`, `push_files`,
`search_repositories`, `search_code`, `list_issues`, `get_issue`,
`create_issue`, `add_issue_comment`, `list_pull_requests`,
`create_pull_request`.

Pull-request detail/review tools, issue update tools, user search and
release tools from the full reference surface are not in this subset.

## Setup

Set a GitHub personal access token:

```bash
export GITHUB_PERSONAL_ACCESS_TOKEN=ghp_...
```

Optionally point at GitHub Enterprise with `GITHUB_API_URL`
(default `https://api.github.com`). Without the token, every tool call
fails with an error naming the missing variable.

## CLI

```bash
npx @reneturcios/codehost-port create_issue '{"owner":"octo","repo":"demo","title":"Bug"}'
npx @reneturcios/codehost-port mcp        # stdio MCP server
```

Each tool name is a subcommand taking one JSON object argument.

## MCP client config

```json
{
  "mcpServers": {
    "codehost-port": {
      "command": "npx",
      "args": ["-y", "@reneturcios/codehost-port", "mcp"],
      "env": { "GITHUB_PERSONAL_ACCESS_TOKEN": "ghp_..." }
    }
  }
}
```

## Docker

```bash
docker run -i -e GITHUB_PERSONAL_ACCESS_TOKEN ghcr.io/cloudcorprecords/codehost-port
```

## Development

```bash
npm install
npm run build
npm test
```

## License

MIT
