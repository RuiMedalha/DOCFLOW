import type { APIRequestContext, APIResponse } from '@playwright/test';
import { API_BASE } from './env';
import { FIXTURE_BIC, FIXTURE_IBAN_DEBTOR, makeNif, uniqueEmail, uniqueSlug } from './pt-ids';
import { setTenantBankDetails } from './db';
import { recordPerf } from './perf';

export interface TokenPair {
  accessToken: string;
  refreshToken: string;
  expiresIn: number;
}

export interface Session {
  email: string;
  password: string;
  tenantSlug: string;
  tenantId: string;
  tenantName: string;
  userId: string;
  role: string;
  tokens: TokenPair;
}

export interface ErrorBody {
  statusCode: number;
  error: string;
  message: string | string[];
  path?: string;
  timestamp?: string;
  requestId?: string;
}

let ipSeq = 1;
export function nextForwardedIp(): string {
  ipSeq += 1;
  return `203.0.113.${(ipSeq % 200) + 1}`;
}

export function unwrap<T>(payload: unknown): T {
  if (payload && typeof payload === 'object' && 'data' in (payload as object)) {
    return (payload as { data: T }).data;
  }
  return payload as T;
}

export class Api {
  constructor(private readonly request: APIRequestContext) {}

  headers(token?: string, extra?: Record<string, string>): Record<string, string> {
    const h: Record<string, string> = {
      Accept: 'application/json',
      'X-Forwarded-For': nextForwardedIp(),
      ...extra,
    };
    if (token) h.Authorization = `Bearer ${token}`;
    return h;
  }

  async raw(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: {
      token?: string;
      data?: unknown;
      headers?: Record<string, string>;
      multipart?: Record<string, string | number | boolean | { name: string; mimeType: string; buffer: Buffer }>;
      timeout?: number;
    } = {},
  ): Promise<APIResponse> {
    const url = path.startsWith('http') ? path : `${API_BASE}${path}`;
    const headers = this.headers(opts.token, opts.headers);
    if (opts.multipart) {
      // Do not set Content-Type: Playwright must emit multipart boundary.
      const { 'Content-Type': _drop, ...rest } = headers as Record<string, string> & {
        'Content-Type'?: string;
      };
      return this.request.fetch(url, {
        method,
        headers: rest,
        multipart: opts.multipart,
        timeout: opts.timeout,
        failOnStatusCode: false,
      });
    }
    return this.request.fetch(url, {
      method,
      headers: { 'Content-Type': 'application/json', ...headers },
      data: opts.data as object | undefined,
      timeout: opts.timeout,
      failOnStatusCode: false,
    });
  }

  async json<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: Parameters<Api['raw']>[2] = {},
  ): Promise<{ status: number; body: T; raw: APIResponse; ms: number }> {
    const started = Date.now();
    const raw = await this.raw(method, path, opts);
    const ms = Date.now() - started;
    let body: T;
    const text = await raw.text();
    try {
      body = text ? (JSON.parse(text) as T) : ({} as T);
    } catch {
      body = text as unknown as T;
    }
    return { status: raw.status(), body, raw, ms };
  }

  async data<T>(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    opts: Parameters<Api['raw']>[2] = {},
    expected = 200,
  ): Promise<T> {
    const res = await this.json<{ data?: T } & T>(method, path, opts);
    if (res.status !== expected) {
      throw new Error(
        `${method} ${path} expected ${expected}, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    return unwrap<T>(res.body);
  }

  async timed(
    method: 'GET' | 'POST' | 'PATCH' | 'DELETE',
    path: string,
    budgetMs: number,
    opts: Parameters<Api['raw']>[2] = {},
  ) {
    const res = await this.json(method, path, opts);
    recordPerf({
      endpoint: path.split('?')[0],
      method,
      ms: res.ms,
      budgetMs,
      ok: res.ms < budgetMs && res.status < 500,
      status: res.status,
    });
    return res;
  }

  async registerTenant(overrides: Partial<{
    tenantName: string;
    tenantSlug: string;
    tenantNif: string;
    email: string;
    password: string;
    name: string;
    withBank: boolean;
  }> = {}): Promise<Session> {
    const password = overrides.password ?? 'Admin123!Secure';
    const tenantSlug = overrides.tenantSlug ?? uniqueSlug('t');
    const payload = {
      tenantName: overrides.tenantName ?? `E2E ${tenantSlug}`,
      tenantSlug,
      tenantNif: overrides.tenantNif ?? makeNif(),
      email: overrides.email ?? uniqueEmail('admin'),
      password,
      name: overrides.name ?? 'E2E Admin',
    };
    let body: {
      user: { id: string; email: string; role: string; tenantId: string };
      tenant: { id: string; name: string; slug: string };
      tokens: TokenPair;
    } | undefined;
    for (let attempt = 0; attempt < 6; attempt++) {
      const res = await this.json<{ data?: typeof body } & { statusCode?: number }>(
        'POST',
        '/auth/register',
        { data: payload },
      );
      if (res.status === 201) {
        body = unwrap(res.body);
        break;
      }
      if (res.status === 429) {
        await new Promise((r) => setTimeout(r, 400 * (attempt + 1)));
        continue;
      }
      throw new Error(
        `POST /auth/register expected 201, got ${res.status}: ${JSON.stringify(res.body)}`,
      );
    }
    if (!body) {
      throw new Error('POST /auth/register exhausted retries (429)');
    }

    if (overrides.withBank !== false) {
      await setTenantBankDetails(body.tenant.id, FIXTURE_IBAN_DEBTOR, FIXTURE_BIC);
    }

    return {
      email: payload.email,
      password,
      tenantSlug: body.tenant.slug,
      tenantId: body.tenant.id,
      tenantName: body.tenant.name,
      userId: body.user.id,
      role: body.user.role,
      tokens: body.tokens,
    };
  }

  async login(
    email: string,
    password: string,
    tenantSlug: string,
  ): Promise<Session> {
    const body = await this.data<{
      user: { id: string; email: string; role: string; tenantId: string };
      tenant: { id: string; name: string; slug: string };
      tokens: TokenPair;
    }>('POST', '/auth/login', {
      data: { email, password, tenantSlug },
    });
    return {
      email,
      password,
      tenantSlug: body.tenant.slug,
      tenantId: body.tenant.id,
      tenantName: body.tenant.name,
      userId: body.user.id,
      role: body.user.role,
      tokens: body.tokens,
    };
  }

  auth(session: Session, extra?: Record<string, string>) {
    return { token: session.tokens.accessToken, headers: extra };
  }
}

/** Minimal valid-enough PDF used for uploads. */
export function minimalPdf(bytes = 2048, marker = 'DocFlow E2E'): Buffer {
  const head = Buffer.from(
    `%PDF-1.4\n1 0 obj<< /Type /Catalog >>endobj\n% ${marker}\n`,
    'utf8',
  );
  if (bytes <= head.length) return head;
  return Buffer.concat([head, Buffer.alloc(bytes - head.length, 0x20), Buffer.from('\n%%EOF\n')]);
}

export function csvStatement(rows: Array<{
  date: string;
  description: string;
  amount: string;
  reference?: string;
}>): string {
  const header = 'Data;Descrição;Valor;Referência';
  const body = rows
    .map((r) => `${r.date};${r.description};${r.amount};${r.reference ?? ''}`)
    .join('\n');
  return `${header}\n${body}\n`;
}

export const CSV_MAPPING = {
  date: 'Data',
  description: 'Descrição',
  amount: 'Valor',
  reference: 'Referência',
};

/** Native FormData upload — Playwright's multipart body is truncated by Nest/multer. */
export async function uploadDocument(
  token: string,
  file: { buffer: Buffer; filename: string; mimeType: string },
  fields: Record<string, string> = {},
): Promise<{ status: number; body: unknown; ms: number }> {
  const form = new FormData();
  form.append(
    'file',
    new Blob([new Uint8Array(file.buffer)], { type: file.mimeType }),
    file.filename,
  );
  for (const [k, v] of Object.entries(fields)) form.append(k, v);
  const started = Date.now();
  const res = await fetch(`${API_BASE}/documents/upload`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${token}`,
      'X-Forwarded-For': nextForwardedIp(),
    },
    body: form,
  });
  const text = await res.text();
  let body: unknown = text;
  try {
    body = text ? JSON.parse(text) : {};
  } catch {
    /* raw */
  }
  return { status: res.status, body, ms: Date.now() - started };
}
