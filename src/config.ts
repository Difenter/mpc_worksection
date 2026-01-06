import { z } from 'zod';

const configSchema = z.object({
  accountUrl: z.string().url('WORKSECTION_ACCOUNT_URL must be a valid https:// URL ending with your workspace'),
  apiKey: z.string().min(1, 'WORKSECTION_ADMIN_API_KEY is required to authenticate with Worksection'),
  slackBotToken: z.string().optional()
});

export type WorksectionConfig = z.infer<typeof configSchema>;

function normalizeAccountUrl(rawUrl: string): string {
  const parsed = new URL(rawUrl);
  const serialized = parsed.toString();
  return serialized.endsWith('/') ? serialized : `${serialized}/`;
}

export function loadConfig(): WorksectionConfig {
  const accountUrl = process.env.WORKSECTION_ACCOUNT_URL;
  if (!accountUrl) {
    throw new Error('Set WORKSECTION_ACCOUNT_URL to your Worksection workspace url, e.g. https://company.worksection.com');
  }

  const adminApiKey = process.env.WORKSECTION_ADMIN_API_KEY?.trim();
  if (!adminApiKey) {
    throw new Error('Set WORKSECTION_ADMIN_API_KEY to authenticate the MCP server.');
  }

  return configSchema.parse({
    accountUrl: normalizeAccountUrl(accountUrl),
    apiKey: adminApiKey,
    slackBotToken: extractSlackBotToken()
  });
}

function extractSlackBotToken(): string | undefined {
  const directToken = process.env.SLACK_FILE_BEARER_TOKEN?.trim();
  if (directToken) {
    return directToken;
  }

  const slackAppBlob = process.env.SLACK_APP_JETBASE_AGENT_PM_TEST;
  if (!slackAppBlob) {
    return undefined;
  }

  try {
    const parsed = JSON.parse(slackAppBlob) as {
      OAUTH_TOKENS?: Record<string, unknown>;
      [key: string]: unknown;
    };

    const nestedToken = parsed?.OAUTH_TOKENS?.BOT_USER_OAUTH_TOKEN;
    const fallbackToken = (parsed as Record<string, unknown>).BOT_USER_OAUTH_TOKEN;
    const tokenCandidate = typeof nestedToken === 'string' ? nestedToken : typeof fallbackToken === 'string' ? fallbackToken : undefined;

    return tokenCandidate?.trim() || undefined;
  } catch (error) {
    throw new Error(
      `Failed to parse SLACK_APP_JETBASE_AGENT_PM_TEST: ${(error as Error).message}. ` +
        'Provide a JSON blob with OAUTH_TOKENS.BOT_USER_OAUTH_TOKEN or use SLACK_FILE_BEARER_TOKEN.'
    );
  }
}
