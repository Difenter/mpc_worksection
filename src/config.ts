import { z } from 'zod';

const configSchema = z.object({
  accountUrl: z.string().url('WORKSECTION_ACCOUNT_URL must be a valid https:// URL ending with your workspace'),
  apiKey: z.string().min(1, 'WORKSECTION_ADMIN_API_KEY is required to authenticate with Worksection')
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
    apiKey: adminApiKey
  });
}
