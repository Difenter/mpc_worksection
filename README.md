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

- `listUsers` – lists all visible users.
- `listProjects` – lists projects with optional state filters and `extra` details.
- `listProjectTasks` – lists every task in a project, optionally limited to active tasks and enriched with extras.
- `getTask` – fetches a single task with optional extras/relations/subtasks.
- `createTask` – creates tasks or subtasks (`post_task`).
- `addComment` – posts comments (and optional checklists) to tasks.

## Exposed resources

- `worksection://projects` – snapshot of all projects (text/options/users included).
- `worksection://users` – mirrors the `listUsers` tool output.
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
