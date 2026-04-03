import http from "node:http";
import https from "node:https";

export function postJson(
  urlString: string,
  headers: Record<string, string>,
  payload: unknown,
  timeoutMs = 15_000,
  signal?: AbortSignal
) {
  const url = new URL(urlString);
  const body = JSON.stringify(payload);
  const transport = url.protocol === "http:" ? http : https;

  return new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
    const request = transport.request(
      url,
      {
        method: "POST",
        headers: {
          ...headers,
          "content-length": Buffer.byteLength(body).toString()
        }
      },
      (response) => {
        const chunks: Buffer[] = [];

        response.on("data", (chunk) => {
          chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
        });

        response.on("end", () => {
          resolve({
            statusCode: response.statusCode ?? 0,
            body: Buffer.concat(chunks).toString("utf8")
          });
        });
      }
    );

    const onAbort = () => {
      request.destroy(new Error("chat_request_aborted"));
    };

    request.setTimeout(timeoutMs, () => {
      request.destroy(new Error(`chat_model_timeout:${timeoutMs}`));
    });
    if (signal?.aborted) {
      onAbort();
      return;
    }

    signal?.addEventListener("abort", onAbort, { once: true });
    request.on("error", reject);
    request.on("close", () => {
      if (signal) {
        signal.removeEventListener("abort", onAbort);
      }
    });
    request.write(body);
    request.end();
  });
}

export function resolveMessagesUrl() {
  const baseUrl = process.env.ANTHROPIC_BASE_URL?.trim();

  if (!baseUrl) {
    return null;
  }

  return new URL(
    baseUrl.endsWith("/v1") || baseUrl.endsWith("/v1/")
      ? `${baseUrl.replace(/\/$/, "")}/messages`
      : `${baseUrl.replace(/\/$/, "")}/v1/messages`
  ).toString();
}

export function extractTextContent(payload: unknown) {
  if (!payload || typeof payload !== "object" || !("content" in payload) || !Array.isArray(payload.content)) {
    return null;
  }

  return payload.content
    .filter((item): item is { type: string; text?: string } => Boolean(item && typeof item === "object"))
    .filter((item) => item.type === "text" && typeof item.text === "string")
    .map((item) => item.text?.trim())
    .filter(Boolean)
    .join("\n")
    .trim();
}
