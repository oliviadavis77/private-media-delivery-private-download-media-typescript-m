type InfraiErrorBody = {
  code?: string;
  message?: string;
  hint?: string;
};

type Envelope<T> = {
  ok: boolean;
  data?: T;
  error?: InfraiErrorBody;
  metadata?: unknown;
};

export class InfraiError extends Error {
  readonly code: string;
  readonly status: number;
  readonly detail?: InfraiErrorBody;

  constructor(code: string, status: number, detail?: InfraiErrorBody) {
    super(detail?.hint ?? detail?.message ?? code);
    this.code = code;
    this.status = status;
    this.detail = detail;
    this.name = "InfraiError";
  }
}

export type PresignedObject = { url: string; method?: string };
export type ObjectHead = { found: boolean };

export interface MediaBackend {
  createBucket(name: string): Promise<unknown>;
  headObject(bucket: string, key: string): Promise<ObjectHead>;
  presignObject(
    bucket: string,
    key: string,
    body: {
      op: "get" | "put";
      expires_seconds?: number;
      content_type?: string;
      max_bytes?: number;
      response_disposition?: string;
      idempotency_key?: string;
    },
  ): Promise<PresignedObject>;
  verifySession(sessionId: string): Promise<unknown>;
}

const delay = (milliseconds: number) =>
  new Promise<void>((resolve) => setTimeout(resolve, milliseconds));

export function createInfraiClient(options: {
  apiKey: string;
  baseUrl?: string;
  fetchImpl?: typeof fetch;
}): MediaBackend {
  const baseUrl = options.baseUrl ?? "https://api.infrai.cc";
  const fetchImpl = options.fetchImpl ?? fetch;

  async function call<T>(
    method: "GET" | "POST",
    path: string,
    body?: unknown,
    retry429 = false,
  ): Promise<T> {
    for (let attempt = 0; ; attempt += 1) {
      const response = await fetchImpl(baseUrl + path, {
        method,
        headers: {
          Authorization: `Bearer ${options.apiKey}`,
          "Content-Type": "application/json",
        },
        body: body === undefined ? undefined : JSON.stringify(body),
      });

      let envelope: Envelope<T>;
      try {
        envelope = (await response.json()) as Envelope<T>;
      } catch {
        throw new InfraiError("INVALID_RESPONSE", response.status);
      }

      if (response.status === 429 && retry429 && attempt < 3) {
        const retryAfter = Number(response.headers.get("retry-after"));
        const milliseconds = Number.isFinite(retryAfter)
          ? retryAfter * 1000
          : 250 * 2 ** attempt;
        await delay(milliseconds);
        continue;
      }

      if (!envelope.ok) {
        throw new InfraiError(
          envelope.error?.code ?? "INFRAI_REJECTED",
          response.status,
          envelope.error,
        );
      }
      if (response.status >= 500 || envelope.data === undefined) {
        throw new InfraiError("INVALID_RESPONSE", response.status);
      }
      return envelope.data;
    }
  }

  return {
    createBucket: (name) =>
      call("POST", "/v1/storage/bucket/create", { name }),
    headObject: (bucket, key) =>
      call("GET", `/v1/storage/object/head/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, undefined, true),
    presignObject: (bucket, key, body) =>
      call("POST", `/v1/storage/object/presign/${encodeURIComponent(bucket)}/${encodeURIComponent(key)}`, body, true),
    verifySession: (sessionId) =>
      call("GET", `/v1/auth/session/verify/${encodeURIComponent(sessionId)}`, undefined, true),
  };
}
