export async function fetchJsonResponseWithTimeout<T>(
  url: string,
  init: RequestInit,
  timeoutMs: number,
): Promise<{ response: Response; data?: T }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(url, {
      ...init,
      signal: controller.signal,
    });

    if (!response.ok) {
      return { response };
    }

    const rawBody = await response.text();

    if (rawBody.trim().length === 0) {
      return { response };
    }

    return {
      response,
      data: JSON.parse(rawBody) as T,
    };
  } finally {
    clearTimeout(timeout);
  }
}

export function getFetchErrorMessage(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") {
    return "Request timed out";
  }

  return error instanceof Error ? error.message : "Unknown error";
}
