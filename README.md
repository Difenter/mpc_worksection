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

| Variable                    | Description                                                                                                              |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `WORKSECTION_ACCOUNT_URL`   | Base URL of your workspace, e.g. `https://example.worksection.com`                                                       |
| `WORKSECTION_ADMIN_API_KEY` | Admin API key for hash-based authentication.                                                                             |
| `WORKSECTION_TRANSPORT`     | `http` (default), `stdio`, or `both`.                                                                                    |
| `WORKSECTION_HTTP_PORT`     | Port for the HTTP MCP endpoint (default `3333`).                                                                         |
| `WORKSECTION_HTTP_HOST`     | Host/interface for HTTP mode (default `0.0.0.0`).                                                                        |
| `SLACK_FILE_BEARER_TOKEN`   | _(Optional)_ Bearer token used when downloading attachment URLs (e.g. Slack file links) before uploading to Worksection. |

If you already store a Slack app blob that includes `OAUTH_TOKENS.BOT_USER_OAUTH_TOKEN` (for example via `SLACK_APP_JETBASE_AGENT_PM_TEST`), the server will read that environment variable and reuse the contained bot token automatically, so you don’t have to duplicate the secret.

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

- `get_users` – lists all visible users (`get_users` action). No inputs.
- `get_projects` – lists projects; optional `filter` (`active`, `pending`, `archive`) and `include` (`text`, `options`, `users`) map to Worksection’s `extra`.
- `get_project` – fetches a single project; optional `include` supports the same extras (`text`, `options`, `users`).
- `get_tasks` – lists tasks inside `projectId`; optional `activeOnly` and `include` (`text`, `files`, `comments`, `relations`, `subtasks`, `subscribers`).
- `get_task` – fetches one task; optional `include` (same as `get_tasks`) and `activeSubtasksOnly`.
- `get_comments` – lists comments on `taskId`; optional `include: ["files"]` to include attachment metadata.
- `get_task_tags` – lists task tags; optional `group` (group name or ID), `type` (`status` or `label`), and `access` (`public` or `private`) map directly to Worksection’s `get_task_tags` parameters.
- `get_task_tag_groups` – lists task tag groups; optional `type` (`status` or `label`) and `access` (`public` or `private`).
- `get_costs` – returns cost rows; optional `projectId`, `taskId`, `startDate`, `endDate`, `isTimer`, `filter`.
- `get_costs_total` – aggregates totals; optional `projectId`, `taskId`, `startDate`, `endDate`, `isTimer`, `filter`, `include: ["projects"]`.
- `get_timers` – lists currently running timers. No inputs.
- `post_task` – creates tasks/subtasks; optional fields include `description`, `parentTaskId`, `assigneeEmail`, `priority`, `startDate`, `dueDate`, `checklist`, `subscribeEmails`, `visibilityEmails`, `mentionEmails`, `estimateHours`, `budget`, `tags`, and `attachments` (either inlined base64 data or `sourceUrl` that the server downloads via Slack-authenticated HTTP).
- `post_comment` – posts comments; optional `text`, `checklist`, `visibilityEmails`, `mentionEmails` (one of `text` or `checklist` required).

### Using Worksection extras via `include`

Wherever a tool accepts `include`, it gets translated into Worksection’s `extra` query parameter (comma-separated). Example: calling `get_project` with `include: ["text", "users"]` issues `?action=get_project&id_project=123&extra=text,users`, so you receive the full description plus team members in one response.

Supported extras:

- `get_projects` / `get_project`: `text`, `options`, `users`
- `get_tasks` / `get_task`: `text`, `files`, `comments`, `relations`, `subtasks`, `subscribers`
- `get_comments`: `files`
- `get_costs_total`: `projects`

### Cost filtering reference (`get_costs`, `get_costs_total`)

Both cost tools accept Worksection’s filter syntax:

- Scope by ID: `project=2456`, `id in (123, 456)`
- String filters: `comment = 'Monthly report'`, `comment has 'report'`
- Date filters: `dateadd > '01.05.2024'`
- Combine with parentheses and `and`/`or`: `(comment has 'report' or comment has 'review') and (dateadd<'25.05.2024' and dateadd>'31.05.2024')`

Dates in `startDate`/`endDate` can be ISO (`YYYY-MM-DD`) or already formatted (`DD.MM.YYYY`); the server converts ISO to Worksection’s preferred format.

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

## Docker

### Build & run (HTTP mode)

```bash
docker build -t worksection-mcp .
docker run --rm -p 3333:3333 \
  -e WORKSECTION_ACCOUNT_URL=https://me0000.worksection.com \
  -e WORKSECTION_ADMIN_API_KEY=909ijs9djvsjs09jv90j09joikjm1f20 \
  -e WORKSECTION_TRANSPORT=http \
  -e WORKSECTION_HTTP_PORT=3333 \
  -e WORKSECTION_HTTP_HOST=0.0.0.0 \
  -e SLACK_APP_JETBASE_AGENT_PM_TEST="{\"NAME\":\"Agent_PM_Test\",\"OAUTH_TOKENS\":{\"USER_OAUTH_TOKEN\":\"xoxp-...\",\"BOT_USER_OAUTH_TOKEN\":\"xoxb-...\"}}" \
  worksection-mcp
```

### Docker Compose

Put your secrets into `.env` (Compose automatically reads it), then:

```bash
docker compose up --build
```

If you set `SLACK_APP_JETBASE_AGENT_PM_TEST` in `.env`, prefer a raw JSON value (no surrounding quotes), e.g.:

```dotenv
SLACK_APP_JETBASE_AGENT_PM_TEST={"NAME":"","OAUTH_TOKENS":{"USER_OAUTH_TOKEN":"","BOT_USER_OAUTH_TOKEN":""}}
```
