type QueryValue = string | number | boolean | undefined | null;

export class HttpError extends Error {
  readonly status: number;
  readonly body: unknown;

  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.body = body;
  }
}

export interface JsonRequestOptions extends Omit<RequestInit, "body"> {
  query?: Record<string, QueryValue>;
  json?: unknown;
  timeoutMs?: number;
}

export async function requestJson<T>(
  input: string | URL,
  options: JsonRequestOptions = {}
): Promise<T> {
  const url = new URL(typeof input === "string" ? input : input.toString());

  for (const [key, value] of Object.entries(options.query ?? {})) {
    if (value === undefined || value === null || value === "") {
      continue;
    }

    url.searchParams.set(key, String(value));
  }

  const requestInit: RequestInit = {
    ...options,
    headers: {
      accept: "application/json",
      ...(options.json ? { "content-type": "application/json" } : {}),
      ...options.headers
    },
    signal: AbortSignal.timeout(options.timeoutMs ?? 15_000)
  };

  if (options.json !== undefined) {
    requestInit.body = JSON.stringify(options.json);
  }

  const response = await fetch(url, requestInit);

  const rawBody = await response.text();
  const body = tryParseJson(rawBody);

  if (!response.ok) {
    throw new HttpError(
      `Request failed with status ${response.status} for ${url.toString()}`,
      response.status,
      body
    );
  }

  return body as T;
}

function tryParseJson(value: string): unknown {
  if (value.length === 0) {
    return null;
  }

  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}
