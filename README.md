# Worksection MCP Server

This project exposes the Worksection project-management API through the [Model Context Protocol](https://modelcontextprotocol.io/), so agents can inspect projects, tasks and comments or create new records directly from MCP-enabled clients.

## Prerequisites

- Node.js 18+ (the devcontainer uses Node 22)
- A Worksection admin API key

## Installation

```bash
npm install
```

## Configuration

Set the following environment variables before running the server:

| Variable | Description |
| --- | --- |
| `WORKSECTION_ACCOUNT_URL` | Base URL of your workspace, e.g. `https://example.worksection.com` |
| `WORKSECTION_ADMIN_API_KEY` | Admin API key for hash-based authentication. |
| `WORKSECTION_TRANSPORT` | `http` (default), `stdio`, or `both`. |
| `WORKSECTION_HTTP_PORT` | Port for the HTTP MCP endpoint (default `3333`). |
| `WORKSECTION_HTTP_HOST` | Host/interface for HTTP mode (default `0.0.0.0`). |

## Running the server

For iterative development:

```bash
npm run dev
```

For production / HTTP usage:

```bash
npm run build
npm start    # loads .env and serves HTTP on /mcp by default
```

To run in stdio mode (for tools like the MCP Inspector or Claude’s CLI), start with `WORKSECTION_TRANSPORT=stdio`.

## Available tools

- `get_users` – lists all visible users (`get_users` action).
- `get_projects` – lists projects with optional state filters and `extra` details.
- `get_project` – fetches a single project with optional extras.
- `get_tasks` – lists every task in a project, optionally limited to active tasks and enriched with extras.
- `get_task` – fetches a single task with optional extras/relations/subtasks.
- `get_comments` – lists comments on a task (optionally include attached files).
- `post_task` – creates tasks or subtasks.
- `post_comment` – posts comments (and optional checklists) to tasks.

### Adding optional extras (Worksection `extra` query param)

Worksection’s API allows extra data to be pulled in by supplying the `extra` query parameter (comma-separated). The MCP tools expose the same capability via each tool’s `include` array input—it gets translated into `extra=<value1,value2,...>` when calling Worksection. For example, `get_projects` with `include: ["text", "users"]` results in:

```
?action=get_projects&id_project=PROJECT_ID&extra=text,users
```

Supported extras:

- `get_projects` and `get_project` → `text`, `options`, `users` (matches Worksection’s project extras)
- `get_tasks` and `get_task` → `text`, `files`, `comments`, `relations`, `subtasks`, `subscribers` (all helpers supported by `get_tasks`/`get_task`)
- `get_comments` → `files` (include comment attachment details)

Any combination can be specified, e.g. `extra=text,options,users` if you need the HTML description, restriction options, and project team in a single `get_projects` or `get_project` call.

## Exposed resources

- `worksection://projects` – snapshot of all projects (text/options/users included).
- `worksection://users` – mirrors the `get_users` tool output.
- `worksection://projects/{projectId}/tasks` – lazily loads tasks for the supplied project ID (with comments/subtasks/etc.).
- `worksection://tasks/{taskId}` – returns rich details for a specific task.

## Using the HTTP endpoint (e.g. n8n MCP node)

1. Populate `.env` (or your deployment secrets) with your Worksection URL + admin API key.
2. Run `npm run build` once, then start the server (`npm start`). It listens on `http://0.0.0.0:3333/mcp` by default.
3. In n8n’s MCP client node, set:
   - **Endpoint:** `http://<host>:3333/mcp`
   - **Transport:** HTTP Streamable
   - **Authentication:** None (the server already authenticates to Worksection using your env vars)
4. n8n can now call any of the tools listed above.

## Using stdio-based MCP clients

Some MCP clients (Claude Desktop, VS Code MCP extension, Cursor) launch commands instead of hitting HTTP.
Create an entry like the following (or adapt `mcp.json`) and set `WORKSECTION_TRANSPORT=stdio` so the server talks over stdio:

```json
{
  "name": "worksection",
  "command": "node",
  "args": ["dist/index.js"],
  "env": {
    "WORKSECTION_TRANSPORT": "stdio",
    "WORKSECTION_ACCOUNT_URL": "https://youraccount.worksection.com",
    "WORKSECTION_ADMIN_API_KEY": "<paste-admin-api-key-here>"
  }
}
```

Use `npm run inspector` (which forces stdio transport) if you want to debug with the MCP Inspector.
