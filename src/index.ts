import express from "express";
import {
  McpServer,
  ResourceTemplate,
} from "@modelcontextprotocol/sdk/server/mcp.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { z } from "zod";
import pkg from "../package.json";
import { loadConfig, type WorksectionConfig } from "./config.js";
import {
  WorksectionApiError,
  WorksectionClient,
  type RequestParams,
  type AttachmentInput,
  type CallOptions,
} from "./worksectionClient.js";

const projectExtras = ["text", "options", "users"] as const;
const taskExtras = [
  "text",
  "files",
  "comments",
  "relations",
  "subtasks",
  "subscribers",
] as const;
const commentExtras = ["files"] as const;
const costTotalsExtras = ["projects"] as const;

type ProjectExtra = (typeof projectExtras)[number];
type TaskExtra = (typeof taskExtras)[number];
type CommentExtra = (typeof commentExtras)[number];
type CostTotalsExtra = (typeof costTotalsExtras)[number];

const pkgVersion = typeof pkg.version === "string" ? pkg.version : "0.0.0";

const respond = (data: unknown) => ({
  content: [
    {
      type: "text" as const,
      text: JSON.stringify(data, null, 2),
    },
  ],
  structuredContent: data,
});

const logError = (context: string, error: unknown) => {
  const label = context ? `[${context}]` : "[error]";
  if (error instanceof Error) {
    console.error(`${label} ${error.message}`);
    console.error(error.stack);
  } else {
    console.error(`${label} ${String(error)}`);
  }
};

const respondError = (error: unknown, context = "mcp") => {
  logError(context, error);
  return {
    content: [
      {
        type: "text" as const,
        text: error instanceof Error ? error.message : String(error),
      },
    ],
    isError: true as const,
  };
};

const commaSeparated = (values?: string[]) =>
  values && values.length ? values.join(", ") : undefined;

const formatWsDate = (raw?: string) => {
  if (!raw) return undefined;
  const trimmed = raw.trim();
  const isoMatch = trimmed.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    const [, year, month, day] = isoMatch;
    return `${day}.${month}.${year}`;
  }

  return trimmed;
};

const recordAny = z.record(z.string(), z.any());

const emptyArgsSchema = z.object({});
const listUsersOutputSchema = z.object({
  count: z.number(),
  users: z.array(recordAny),
});

const listProjectsArgsSchema = z.object({
  filter: z.enum(["active", "pending", "archive"]).optional(),
  include: z.array(z.enum(projectExtras)).optional(),
});
type ListProjectsArgs = z.infer<typeof listProjectsArgsSchema>;
const listProjectsOutputSchema = z.object({
  count: z.number(),
  projects: z.array(recordAny),
  appliedFilter: z.string().nullable(),
  requestedExtras: z.array(z.string()),
});

const getProjectArgsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  include: z.array(z.enum(projectExtras)).optional(),
});
type GetProjectArgs = z.infer<typeof getProjectArgsSchema>;

const getProjectOutputSchema = z.object({
  project: recordAny,
});

const listProjectTasksArgsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  activeOnly: z.boolean().optional(),
  include: z.array(z.enum(taskExtras)).optional(),
});
type ListProjectTasksArgs = z.infer<typeof listProjectTasksArgsSchema>;
const listProjectTasksOutputSchema = z.object({
  projectId: z.string(),
  count: z.number(),
  tasks: z.array(recordAny),
});

const getTaskArgsSchema = z.object({
  taskId: z.string().min(1, "Task ID is required"),
  include: z.array(z.enum(taskExtras)).optional(),
  activeSubtasksOnly: z.boolean().optional(),
});
type GetTaskArgs = z.infer<typeof getTaskArgsSchema>;
const getTaskOutputSchema = z.object({
  task: recordAny,
});

const attachmentSchema = z
  .object({
    filename: z.string().min(1, "Attachment filename is required"),
    data: z.string().min(1, "Attachment data (base64) is required").optional(),
    sourceUrl: z
      .string()
      .url("Attachment sourceUrl must be a valid URL")
      .optional(),
    contentType: z.string().optional(),
  })
  .refine(
    (value) => {
      return Boolean(value.data?.length) || Boolean(value.sourceUrl?.length);
    },
    {
      message: "Provide attachment data (base64) or sourceUrl.",
      path: ["data"],
    }
  );

const createTaskArgsSchema = z.object({
  projectId: z.string().min(1, "Project ID is required"),
  title: z.string().min(1, "Task title is required"),
  description: z.string().optional(),
  parentTaskId: z.string().optional(),
  assigneeEmail: z.string().optional(),
  priority: z.number().int().min(0).max(10).optional(),
  startDate: z.string().optional(),
  dueDate: z.string().optional(),
  checklist: z.array(z.string()).optional(),
  subscribeEmails: z.array(z.string()).optional(),
  visibilityEmails: z.array(z.string()).optional(),
  mentionEmails: z.array(z.string()).optional(),
  estimateHours: z.number().nonnegative().optional(),
  budget: z.number().nonnegative().optional(),
  tags: z.array(z.string()).optional(),
  attachments: z.array(attachmentSchema).optional(),
});
type CreateTaskArgs = z.infer<typeof createTaskArgsSchema>;
const createTaskOutputSchema = z.object({
  task: recordAny,
});

const addCommentArgsSchema = z.object({
  taskId: z.string().min(1, "Task ID is required"),
  text: z.string().optional(),
  checklist: z.array(z.string()).optional(),
  visibilityEmails: z.array(z.string()).optional(),
  mentionEmails: z.array(z.string()).optional(),
});
type AddCommentArgs = z.infer<typeof addCommentArgsSchema>;
const addCommentOutputSchema = z.object({
  comment: recordAny,
});

const getCommentsArgsSchema = z.object({
  taskId: z.string().min(1, "Task ID is required"),
  include: z.array(z.enum(commentExtras)).optional(),
});
type GetCommentsArgs = z.infer<typeof getCommentsArgsSchema>;
const getCommentsOutputSchema = z.object({
  taskId: z.string(),
  count: z.number(),
  comments: z.array(recordAny),
});

const getCostsArgsSchemaBase = z.object({
  projectId: z.coerce.string().optional(),
  taskId: z.coerce.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isTimer: z.boolean().optional(),
  filter: z.string().optional(),
});
const getCostsArgsSchema = getCostsArgsSchemaBase.refine(
  (data) => {
    return Boolean(
      data.projectId ||
        data.taskId ||
        data.startDate ||
        data.endDate ||
        data.filter
    );
  },
  {
    message:
      "At least one filter parameter is required (projectId, taskId, startDate, endDate, or filter) to prevent unbounded queries.",
    path: ["projectId"],
  }
);
type GetCostsArgs = z.infer<typeof getCostsArgsSchema>;
const getCostsOutputSchema = z.object({
  count: z.number(),
  costs: z.array(recordAny),
});

const getCostsTotalArgsSchemaBase = z.object({
  projectId: z.coerce.string().optional(),
  taskId: z.coerce.string().optional(),
  startDate: z.string().optional(),
  endDate: z.string().optional(),
  isTimer: z.boolean().optional(),
  filter: z.string().optional(),
  include: z.array(z.enum(costTotalsExtras)).optional(),
});
const getCostsTotalArgsSchema = getCostsTotalArgsSchemaBase.refine(
  (data) => {
    return Boolean(
      data.projectId ||
        data.taskId ||
        data.startDate ||
        data.endDate ||
        data.filter
    );
  },
  {
    message:
      "At least one filter parameter is required (projectId, taskId, startDate, endDate, or filter) to prevent unbounded queries.",
    path: ["projectId"],
  }
);
type GetCostsTotalArgs = z.infer<typeof getCostsTotalArgsSchema>;
const getCostsTotalOutputSchema = z.object({
  totals: recordAny,
});

const getTimersOutputSchema = z.object({
  count: z.number(),
  timers: z.array(recordAny),
});

async function completeProjectIds(
  client: WorksectionClient,
  value: string
): Promise<string[]> {
  try {
    const response = await client.call<{
      data?: Array<{ id?: string | number }>;
    }>("get_projects");
    const projects = Array.isArray(response.data) ? response.data : [];
    const ids = projects
      .map((project) => (project.id !== undefined ? String(project.id) : ""))
      .filter(Boolean);

    const prefix = value ?? "";
    const filtered = prefix ? ids.filter((id) => id.startsWith(prefix)) : ids;
    return filtered.slice(0, 25);
  } catch {
    return [];
  }
}

function registerTools(server: McpServer, client: WorksectionClient) {
  server.registerTool(
    "get_users",
    {
      title: "List Worksection users",
      description: "Fetches account users through the get_users API action.",
      inputSchema: emptyArgsSchema.shape,
      outputSchema: listUsersOutputSchema.shape,
    } as any,
    (async () => {
      try {
        const response = await client.call<{ data?: unknown[] }>("get_users");
        const users = Array.isArray(response.data) ? response.data : [];
        return respond({ count: users.length, users });
      } catch (error) {
        return respondError(error, "get_users");
      }
    }) as any
  );

  server.registerTool(
    "get_projects",
    {
      title: "List Worksection projects",
      description:
        "Reads project metadata with optional filters and extra fields.",
      inputSchema: listProjectsArgsSchema.shape,
      outputSchema: listProjectsOutputSchema.shape,
    } as any,
    (async (args: ListProjectsArgs) => {
      const { filter, include } = args;
      try {
        const params: RequestParams = {};
        if (filter) params.filter = filter;
        if (include?.length) params.extra = include.join(", ");

        const response = await client.call<{ data?: unknown[] }>(
          "get_projects",
          { params }
        );
        const projects = Array.isArray(response.data) ? response.data : [];
        return respond({
          count: projects.length,
          projects,
          appliedFilter: filter ?? null,
          requestedExtras: include ?? [],
        });
      } catch (error) {
        return respondError(error, "get_projects");
      }
    }) as any
  );

  server.registerTool(
    "get_project",
    {
      title: "Get Worksection project",
      description:
        "Calls get_project to fetch a single project with optional extra fields.",
      inputSchema: getProjectArgsSchema.shape,
      outputSchema: getProjectOutputSchema.shape,
    } as any,
    (async (args: GetProjectArgs) => {
      const { projectId, include } = args;
      try {
        const params: RequestParams = { id_project: projectId };
        if (include?.length) params.extra = include.join(", ");

        const response = await client.call<{ data?: Record<string, unknown> }>(
          "get_project",
          { params }
        );
        return respond({ project: response.data ?? {} });
      } catch (error) {
        return respondError(error, "get_project");
      }
    }) as any
  );

  server.registerTool(
    "get_tasks",
    {
      title: "List tasks for a project",
      description: "Calls get_tasks for a single project with optional extras.",
      inputSchema: listProjectTasksArgsSchema.shape,
      outputSchema: listProjectTasksOutputSchema.shape,
    } as any,
    (async (args: ListProjectTasksArgs) => {
      const { projectId, activeOnly, include } = args;
      try {
        const params: RequestParams = {
          id_project: projectId,
        };
        if (activeOnly) params.filter = "active";
        if (include?.length) params.extra = include.join(", ");

        const response = await client.call<{ data?: unknown[] }>("get_tasks", {
          params,
        });
        const tasks = Array.isArray(response.data) ? response.data : [];
        return respond({ projectId, count: tasks.length, tasks });
      } catch (error) {
        return respondError(error, "get_tasks");
      }
    }) as any
  );

  server.registerTool(
    "get_task",
    {
      title: "Get task details",
      description: "Retrieves a single task using the get_task API action.",
      inputSchema: getTaskArgsSchema.shape,
      outputSchema: getTaskOutputSchema.shape,
    } as any,
    (async (args: GetTaskArgs) => {
      const { taskId, include, activeSubtasksOnly } = args;
      try {
        const params: RequestParams = { id_task: taskId };
        if (include?.length) params.extra = include.join(", ");
        if (activeSubtasksOnly) params.filter = "active";

        const response = await client.call<{ data?: Record<string, unknown> }>(
          "get_task",
          { params }
        );
        return respond({ task: response.data ?? {} });
      } catch (error) {
        return respondError(error, "get_task");
      }
    }) as any
  );

  server.registerTool(
    "post_task",
    {
      title: "Create a Worksection task",
      description:
        "Calls post_task to create a task or subtask in Worksection.",
      inputSchema: createTaskArgsSchema.shape,
      outputSchema: createTaskOutputSchema.shape,
    } as any,
    (async (args: CreateTaskArgs) => {
      try {
        const params: RequestParams = {
          id_project: args.projectId,
          title: args.title,
          text: args.description,
          id_parent: args.parentTaskId,
          email_user_to: args.assigneeEmail,
          priority: args.priority,
          datestart: formatWsDate(args.startDate),
          dateend: formatWsDate(args.dueDate),
          subscribe: commaSeparated(args.subscribeEmails),
          hidden: commaSeparated(args.visibilityEmails),
          mention: commaSeparated(args.mentionEmails),
          max_time: args.estimateHours,
          max_money: args.budget,
          tags: commaSeparated(args.tags),
          todo:
            args.checklist && args.checklist.length
              ? args.checklist
              : undefined,
        };

        let attachments: AttachmentInput[] | undefined;
        if (args.attachments?.length) {
          attachments = args.attachments.map((attachment, index) => {
            let buffer: Buffer | undefined;
            if (attachment.data) {
              try {
                buffer = Buffer.from(attachment.data, "base64");
              } catch {
                throw new Error(
                  `Attachment "${attachment.filename}" data must be valid base64.`
                );
              }

              if (buffer.length === 0) {
                throw new Error(
                  `Attachment "${attachment.filename}" is empty or not valid base64 data.`
                );
              }
            }

            const payload: AttachmentInput = {
              field: `attach[${index}]`,
              filename: attachment.filename,
            };

            if (attachment.contentType) {
              payload.contentType = attachment.contentType;
            }

            if (buffer) {
              payload.data = buffer;
            } else if (attachment.sourceUrl) {
              payload.sourceUrl = attachment.sourceUrl;
            } else {
              throw new Error(
                `Attachment "${attachment.filename}" requires base64 data or sourceUrl.`
              );
            }

            return payload;
          });
        }

        const callOptions: CallOptions = { params };
        if (attachments?.length) {
          callOptions.method = "POST";
          callOptions.attachments = attachments;
        }

        const response = await client.call<{ data?: Record<string, unknown> }>(
          "post_task",
          callOptions
        );

        return respond({ task: response.data ?? {} });
      } catch (error) {
        return respondError(error, "post_task");
      }
    }) as any
  );

  server.registerTool(
    "post_comment",
    {
      title: "Create a task comment",
      description:
        "Calls post_comment to add a comment or checklist to a task.",
      inputSchema: addCommentArgsSchema.shape,
      outputSchema: addCommentOutputSchema.shape,
    } as any,
    (async (args: AddCommentArgs) => {
      try {
        if (!args.text && !args.checklist?.length) {
          return respondError(
            new Error("Provide comment text or at least one checklist item."),
            "post_comment"
          );
        }

        const params: RequestParams = {
          id_task: args.taskId,
          text: args.text,
          hidden: commaSeparated(args.visibilityEmails),
          mention: commaSeparated(args.mentionEmails),
          todo:
            args.checklist && args.checklist.length
              ? args.checklist
              : undefined,
        };

        const response = await client.call<{ data?: Record<string, unknown> }>(
          "post_comment",
          {
            params,
          }
        );

        return respond({ comment: response.data ?? {} });
      } catch (error) {
        return respondError(error, "post_comment");
      }
    }) as any
  );

  server.registerTool(
    "get_comments",
    {
      title: "List task comments",
      description:
        "Calls get_comments to retrieve comments for a task with optional file details.",
      inputSchema: getCommentsArgsSchema.shape,
      outputSchema: getCommentsOutputSchema.shape,
    } as any,
    (async (args: GetCommentsArgs) => {
      const { taskId, include } = args;
      try {
        const params: RequestParams = { id_task: taskId };
        if (include?.length) params.extra = include.join(", ");

        const response = await client.call<{ data?: unknown[] }>(
          "get_comments",
          { params }
        );
        const comments = Array.isArray(response.data) ? response.data : [];
        return respond({ taskId, count: comments.length, comments });
      } catch (error) {
        return respondError(error, "get_comments");
      }
    }) as any
  );

  server.registerTool(
    "get_costs",
    {
      title: "List task/project costs",
      description:
        "Calls get_costs to fetch logged time/money entries. Requires at least one filter parameter (projectId, taskId, startDate, endDate, or filter) to prevent unbounded queries. " +
        "The filter parameter supports Worksection filter syntax: Integer fields (id=TASK_ID, project=PROJECT_ID) with operators =, in; " +
        "String fields (comment) with operators =, has; Date fields (dateadd in DD.MM.YYYY format) with operators >, <, >=, <=, !=, =; " +
        "Combine with parentheses and logical operations (and, or). Example: project = 2456, comment has 'report', dateadd>'01.05.2021', or (comment has 'report' or comment has 'review') and dateadd>'01.01.2026'.",
      inputSchema: getCostsArgsSchemaBase.shape,
      outputSchema: getCostsOutputSchema.shape,
    } as any,
    (async (args: GetCostsArgs) => {
      try {
        // Validate that at least one filter is provided (schema should catch this, but double-check for safety)
        if (
          !args.projectId &&
          !args.taskId &&
          !args.startDate &&
          !args.endDate &&
          !args.filter
        ) {
          return respondError(
            new Error(
              "At least one filter parameter is required (projectId, taskId, startDate, endDate, or filter) to prevent unbounded queries that may exceed memory limits."
            ),
            "get_costs"
          );
        }

        const params: RequestParams = {};
        if (args.projectId) params.id_project = args.projectId;
        if (args.taskId) params.id_task = args.taskId;
        if (args.startDate) params.datestart = formatWsDate(args.startDate);
        if (args.endDate) params.dateend = formatWsDate(args.endDate);
        if (typeof args.isTimer === "boolean")
          params.is_timer = args.isTimer ? 1 : 0;
        if (args.filter) params.filter = args.filter;

        const response = await client.call<{ data?: unknown[] }>("get_costs", {
          params,
        });
        const costs = Array.isArray(response.data) ? response.data : [];
        return respond({ count: costs.length, costs });
      } catch (error) {
        return respondError(error, "get_costs");
      }
    }) as any
  );

  server.registerTool(
    "get_costs_total",
    {
      title: "Get cost totals",
      description:
        "Calls get_costs_total to aggregate time/money per project or task with optional per-project breakdowns. Requires at least one filter parameter (projectId, taskId, startDate, endDate, or filter) to prevent unbounded queries. " +
        "The filter parameter supports Worksection filter syntax for multiple projects selection: Filter by ID (project=2456), Filter by ID range (project in (1234, 1240)), " +
        "Combining filters with parentheses and logical operators and, or (must be lowercase). Example: project=2456, project in (1234, 1240), or (project=2456 and project=2464) or project in (2450, 2470). " +
        "The include parameter supports: projects (total and monthly costs for each project), tasks (total costs for each task and subtask), tasks_top_level (total costs for tasks only, including subtask costs).",
      inputSchema: getCostsTotalArgsSchemaBase.shape,
      outputSchema: getCostsTotalOutputSchema.shape,
    } as any,
    (async (args: GetCostsTotalArgs) => {
      try {
        // Validate that at least one filter is provided (schema should catch this, but double-check for safety)
        if (
          !args.projectId &&
          !args.taskId &&
          !args.startDate &&
          !args.endDate &&
          !args.filter
        ) {
          return respondError(
            new Error(
              "At least one filter parameter is required (projectId, taskId, startDate, endDate, or filter) to prevent unbounded queries that may exceed memory limits."
            ),
            "get_costs_total"
          );
        }

        const params: RequestParams = {};
        if (args.projectId) params.id_project = args.projectId;
        if (args.taskId) params.id_task = args.taskId;
        if (args.startDate) params.datestart = formatWsDate(args.startDate);
        if (args.endDate) params.dateend = formatWsDate(args.endDate);
        if (typeof args.isTimer === "boolean")
          params.is_timer = args.isTimer ? 1 : 0;
        if (args.filter) params.filter = args.filter;

        // Build extra parameter: if include is provided, use it; otherwise auto-add 'projects' when projectId is used
        const extraParts: string[] = [];
        if (args.include?.length) {
          extraParts.push(...args.include);
        } else if (args.projectId && !args.taskId) {
          // Auto-include 'projects' when filtering by projectId (unless taskId is specified, which ignores projects)
          extraParts.push("projects");
        }
        if (extraParts.length) {
          params.extra = extraParts.join(", ");
        }

        const response = await client.call<{
          data?: Record<string, unknown>;
          [key: string]: unknown;
        }>("get_costs_total", { params });

        // The API might return totals directly in data, or the entire response might be the totals
        // Check if data exists and has content, otherwise return the full response structure
        if (response.data && Object.keys(response.data).length > 0) {
          return respond({ totals: response.data });
        }

        // If data is empty, check if totals are at the root level
        const { data, ...rest } = response;
        if (Object.keys(rest).length > 0) {
          return respond({ totals: rest });
        }

        // Fallback to empty object if nothing found
        return respond({ totals: {} });
      } catch (error) {
        return respondError(error, "get_costs_total");
      }
    }) as any
  );

  server.registerTool(
    "get_timers",
    {
      title: "List running timers",
      description:
        "Calls get_timers to show active timers with IDs, start times, and owners.",
      inputSchema: emptyArgsSchema.shape,
      outputSchema: getTimersOutputSchema.shape,
    } as any,
    (async () => {
      try {
        const response = await client.call<{ data?: unknown[] }>("get_timers");
        const timers = Array.isArray(response.data) ? response.data : [];
        return respond({ count: timers.length, timers });
      } catch (error) {
        return respondError(error, "get_timers");
      }
    }) as any
  );
}

function registerResources(server: McpServer, client: WorksectionClient) {
  server.registerResource(
    "worksection-projects-resource",
    "worksection://projects",
    {
      title: "Worksection projects snapshot",
      description:
        "Full list of projects with text, options and users helpers.",
      mimeType: "application/json",
    },
    async (uri) => {
      const response = await client.call("get_projects", {
        params: { extra: "text, options, users" },
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );

  server.registerResource(
    "worksection-users-resource",
    "worksection://users",
    {
      title: "Worksection users",
      description:
        "Returns the same payload as the get_users tool for quick reference.",
      mimeType: "application/json",
    },
    async (uri) => {
      const response = await client.call("get_users");
      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );

  const projectTasksTemplate = new ResourceTemplate(
    "worksection://projects/{projectId}/tasks",
    {
      list: undefined,
      complete: {
        projectId: (value: string) => completeProjectIds(client, value),
      },
    }
  );

  server.registerResource(
    "worksection-project-tasks-resource",
    projectTasksTemplate,
    {
      title: "Project tasks resource",
      description:
        "Reads tasks (with comments/subscribers) for a given project ID.",
      mimeType: "application/json",
    },
    async (uri, args) => {
      const projectId = args?.projectId;
      if (!projectId) {
        throw new WorksectionApiError(
          "projectId must be supplied in the resource URI"
        );
      }

      const response = await client.call("get_tasks", {
        params: {
          id_project: projectId,
          extra: "text, files, comments, relations, subtasks, subscribers",
        },
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );

  const taskTemplate = new ResourceTemplate("worksection://tasks/{taskId}", {
    list: undefined,
  });

  server.registerResource(
    "worksection-task-resource",
    taskTemplate,
    {
      title: "Single task resource",
      description:
        "Fetches a single task with full context for referencing in chats.",
      mimeType: "application/json",
    },
    async (uri, args) => {
      const taskId = args?.taskId;
      if (!taskId) {
        throw new WorksectionApiError(
          "taskId must be provided in the resource URI"
        );
      }

      const response = await client.call("get_task", {
        params: {
          id_task: taskId,
          extra: "text, files, comments, relations, subtasks, subscribers",
        },
      });

      return {
        contents: [
          {
            uri: uri.href,
            mimeType: "application/json",
            text: JSON.stringify(response, null, 2),
          },
        ],
      };
    }
  );
}

function createServer(config: WorksectionConfig) {
  const client = new WorksectionClient(config);
  const server = new McpServer({
    name: "worksection-mcp",
    version: pkgVersion,
  });

  registerTools(server, client);
  registerResources(server, client);

  return server;
}

async function startStdioServer(config: WorksectionConfig) {
  const server = createServer(config);
  const transport = new StdioServerTransport();
  console.log("Starting Worksection MCP server in stdio mode...");
  await server.connect(transport);
}

async function startHttpServer(config: WorksectionConfig) {
  const port = parseInt(process.env.WORKSECTION_HTTP_PORT ?? "3333", 10);
  const host = process.env.WORKSECTION_HTTP_HOST ?? "0.0.0.0";
  const app = express();
  app.use(express.json({ limit: "1mb" }));

  app.post("/mcp", async (req, res) => {
    const server = createServer(config);
    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true,
    });

    res.on("close", () => {
      transport.close();
    });

    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (error) {
      console.error("HTTP MCP request failed:", error);
      if (!res.headersSent) {
        res.status(500).json({
          jsonrpc: "2.0",
          error: {
            code: -32603,
            message: "Internal server error",
          },
          id: null,
        });
      }
    }
  });

  await new Promise<void>((resolve, reject) => {
    app
      .listen(port, host, () => {
        console.log(
          `Worksection MCP HTTP server listening on http://${host}:${port}/mcp`
        );
        resolve();
      })
      .on("error", reject);
  });
}

async function main() {
  let config: WorksectionConfig;
  try {
    config = loadConfig();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exit(1);
    return;
  }

  const mode = (process.env.WORKSECTION_TRANSPORT ?? "http").toLowerCase();
  const enableHttp = mode === "http" || mode === "both";
  const enableStdio = mode === "stdio" || mode === "both";

  if (!enableHttp && !enableStdio) {
    console.error(
      `Unknown WORKSECTION_TRANSPORT value "${mode}". Use "http", "stdio", or "both".`
    );
    process.exit(1);
    return;
  }

  if (enableHttp) {
    await startHttpServer(config);
  }

  if (enableStdio) {
    await startStdioServer(config);
  }
}

main().catch((error) => {
  console.error("Worksection MCP server failed to start:", error);
  process.exit(1);
});
