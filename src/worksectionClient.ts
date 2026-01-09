import crypto from 'crypto';
import type { WorksectionConfig } from './config.js';

const ADMIN_PATH = 'api/admin/v2';

type Primitive = string | number | boolean;
type ParamValue = Primitive | Primitive[] | null | undefined;

export type RequestParams = Record<string, ParamValue>;

export interface AttachmentPayload {
  field: string;
  filename: string;
  data: Buffer;
  contentType?: string;
}

export interface AttachmentInput {
  field: string;
  filename: string;
  contentType?: string;
  data?: Buffer;
  sourceUrl?: string;
}

export interface CallOptions {
  method?: 'GET' | 'POST';
  params?: RequestParams;
  attachments?: AttachmentInput[];
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
    const attachments = await this.prepareAttachments(options?.attachments);
    const hasAttachments = attachments.length > 0;
    const method = hasAttachments ? 'POST' : options?.method ?? 'GET';
    const params = this.prepareParams(options?.params);
    const { encoded, raw } = this.buildParamState(action, params);

    const hash = crypto.createHash('md5').update(raw + this.config.apiKey).digest('hex');
    encoded.append('hash', hash);

    const basePath = ADMIN_PATH;
    const endpoint = new URL(basePath, this.config.accountUrl);

    const headers: Record<string, string> = { Accept: 'application/json' };
    let body: string | FormData | undefined;

    if (method === 'GET' || hasAttachments) {
      endpoint.search = encoded.toString();
    }

    if (method === 'GET') {
      // no body for GET requests; params carried via query string
    } else if (hasAttachments) {
      const form = new FormData();
      encoded.forEach((value, key) => {
        form.append(key, value);
      });

      attachments.forEach(attachment => {
        const arrayBuffer = attachment.data.buffer.slice(
          attachment.data.byteOffset,
          attachment.data.byteOffset + attachment.data.byteLength
        ) as ArrayBuffer;
        const blob = new Blob([arrayBuffer], {
          type: attachment.contentType ?? 'application/octet-stream'
        });
        form.append(attachment.field, blob, attachment.filename);
      });

      body = form;
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
      // Log request details in development
      if (process.env.NODE_ENV !== 'production') {
        console.log(`[Worksection API] ${method} ${endpoint.toString()}`);
        if (method === 'GET') {
          console.log(`[Worksection API] Query params: ${endpoint.search}`);
        } else if (body) {
          console.log(`[Worksection API] Body: ${typeof body === 'string' ? body : '[FormData]'}`);
        }
      }
      
      response = await fetch(endpoint, init);
    } catch (error) {
      throw new WorksectionApiError(`Failed to reach Worksection API: ${(error as Error).message}`);
    }

    if (!response.ok) {
      const errorText = await response.text();
      console.error(`[Worksection API] HTTP ${response.status} ${response.statusText}: ${errorText}`);
      throw new WorksectionApiError(`Worksection API HTTP ${response.status}: ${response.statusText}`, response.status);
    }

    const json = (await response.json()) as { 
      status?: string; 
      message?: string; 
      status_code?: number;
      message_details?: string;
      test?: string;
    } & Record<string, unknown>;
    
    // Log response in development
    if (process.env.NODE_ENV !== 'production') {
      console.log(`[Worksection API] Response status: ${json.status}`);
      if (json.status !== 'ok') {
        console.error(`[Worksection API] Error response:`, JSON.stringify(json, null, 2));
      }
    }
    
    if (json.status !== 'ok') {
      // Build a more informative error message
      let errorMessage = json.message ?? 'Worksection API returned an error';
      
      if (json.message_details) {
        errorMessage += ` (field: ${json.message_details})`;
      }
      
      if (json.test) {
        errorMessage += `. Expected format: ${String(json.test).trim()}`;
      }
      
      throw new WorksectionApiError(errorMessage, json.status_code);
    }

    return json as T;
  }

  private prepareParams(params?: RequestParams): RequestParams {
    const next: RequestParams = { ...(params ?? {}) };

    return next;
  }

  private async prepareAttachments(attachments?: AttachmentInput[]): Promise<AttachmentPayload[]> {
    if (!attachments?.length) {
      return [];
    }

    const payloads: AttachmentPayload[] = [];
    for (const attachment of attachments) {
      if (attachment.data && attachment.sourceUrl) {
        throw new WorksectionApiError(`Attachment "${attachment.filename}" cannot define both data and sourceUrl.`);
      }

      let buffer: Buffer | undefined = attachment.data;
      if (!buffer && attachment.sourceUrl) {
        buffer = await this.fetchRemoteAttachment(attachment.sourceUrl);
      }

      if (!buffer) {
        throw new WorksectionApiError(
          `Attachment "${attachment.filename}" must include base64 data or a download URL (sourceUrl).`
        );
      }

      const payload: AttachmentPayload = {
        field: attachment.field,
        filename: attachment.filename,
        data: buffer
      };

      if (attachment.contentType) {
        payload.contentType = attachment.contentType;
      }

      payloads.push(payload);
    }

    return payloads;
  }

  private async fetchRemoteAttachment(url: string): Promise<Buffer> {
    const headers: Record<string, string> = {};
    const token = this.config.slackBotToken;
    if (token) {
      headers.Authorization = `Bearer ${token}`;
    }

    let response: Response;
    try {
      response = await fetch(url, { headers });
    } catch (error) {
      throw new WorksectionApiError(`Failed to download attachment from ${url}: ${(error as Error).message}`);
    }

    if (!response.ok) {
      throw new WorksectionApiError(`Downloading attachment failed (${response.status}): ${response.statusText}`);
    }

    const arrayBuffer = await response.arrayBuffer();
    if (arrayBuffer.byteLength === 0) {
      throw new WorksectionApiError(`Attachment at ${url} is empty.`);
    }

    return Buffer.from(arrayBuffer);
  }

  private buildParamState(action: string, params: RequestParams) {
    const encoded = new URLSearchParams();

    const appendParam = (key: string, value: ParamValue): void => {
      if (value === undefined || value === null) {
        return;
      }

      if (Array.isArray(value)) {
        value.forEach((item, index) => {
          appendParam(`${key}[${index}]`, item);
        });
        return;
      }

      encoded.append(key, this.coerceToString(value));
    };

    appendParam('action', action);

    for (const [key, value] of Object.entries(params)) {
      appendParam(key, value);
    }

    const raw = encoded.toString();
    return { encoded, raw };
  }

  private coerceToString(value: Primitive): string {
    if (typeof value === 'boolean') {
      return value ? '1' : '0';
    }

    return String(value);
  }
}
