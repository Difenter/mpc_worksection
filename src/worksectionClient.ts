import crypto from 'crypto';
import type { WorksectionConfig } from './config.js';

const ADMIN_PATH = 'api/admin/v2';

type Primitive = string | number | boolean;
type ParamValue = Primitive | Primitive[] | null | undefined;

export type RequestParams = Record<string, ParamValue>;

export interface CallOptions {
  method?: 'GET' | 'POST';
  params?: RequestParams;
}

export class WorksectionApiError extends Error {
  constructor(message: string, readonly statusCode?: number) {
    super(message);
    this.name = 'WorksectionApiError';
  }
}

export class WorksectionClient {
  constructor(private readonly config: WorksectionConfig) {}

  async call<T = unknown>(action: string, options?: CallOptions): Promise<T> {
    const method = options?.method ?? 'GET';
    const params = this.prepareParams(options?.params);
    const { encoded, raw } = this.buildParamState(action, params);

    const hash = crypto.createHash('md5').update(raw + this.config.apiKey).digest('hex');
    encoded.append('hash', hash);

    const basePath = ADMIN_PATH;
    const endpoint = new URL(basePath, this.config.accountUrl);

    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: string | undefined;

    if (method === 'GET') {
      endpoint.search = encoded.toString();
    } else {
      body = encoded.toString();
      headers['Content-Type'] = 'application/x-www-form-urlencoded';
    }

    const init: RequestInit = { method, headers };
    if (body !== undefined) {
      init.body = body;
    }

    let response: Response;
    try {
      response = await fetch(endpoint, init);
    } catch (error) {
      throw new WorksectionApiError(`Failed to reach Worksection API: ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new WorksectionApiError(`Worksection API HTTP ${response.status}: ${response.statusText}`, response.status);
    }

    const json = (await response.json()) as { status?: string; message?: string; status_code?: number } & Record<string, unknown>;
    if (json.status !== 'ok') {
      throw new WorksectionApiError(json.message ?? 'Worksection API returned an error', json.status_code);
    }

    return json as T;
  }

  private prepareParams(params?: RequestParams): RequestParams {
    const next: RequestParams = { ...(params ?? {}) };

    return next;
  }

  private buildParamState(action: string, params: RequestParams) {
    const pairs: Array<[string, string]> = [['action', action]];

    for (const [key, value] of Object.entries(params)) {
      if (value === undefined || value === null) continue;
      if (Array.isArray(value)) {
        value.forEach(item => pairs.push([key, this.coerceToString(item)]));
      } else {
        pairs.push([key, this.coerceToString(value)]);
      }
    }

    const encoded = new URLSearchParams();
    for (const [key, value] of pairs) {
      encoded.append(key, value);
    }

    const raw = pairs.map(([key, value]) => `${key}=${value}`).join('&');
    return { encoded, raw };
  }

  private coerceToString(value: Primitive): string {
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    return String(value);
  }
}
