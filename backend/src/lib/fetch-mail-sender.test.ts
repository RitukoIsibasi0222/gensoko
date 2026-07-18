import { afterEach, describe, expect, it, vi } from "vitest";
import type { WorkerRuntimeConfig } from "./worker-config.js";
import { createFetchMailSender, MAIL_DELIVERY_ERROR_MESSAGE } from "./fetch-mail-sender.js";

const RECIPIENT = "synthetic-user@example.invalid";
const API_KEY = "sensitive-mail-api-key";
const MAIL_BODY = "sensitive mail body with token=secret-token";

function createConfig(
  overrides: Partial<WorkerRuntimeConfig["mail"]> = {},
): Pick<WorkerRuntimeConfig, "target" | "mail"> {
  return {
    target: "staging",
    mail: {
      apiUrl: "https://mail-api.example.invalid/send",
      apiKey: API_KEY,
      from: "noreply@staging.gensoko.example",
      allowedRecipients: [RECIPIENT],
      timeoutMs: 5_000,
      ...overrides,
    },
  };
}

function createMessage(
  overrides: Partial<Parameters<ReturnType<typeof createFetchMailSender>["send"]>[0]> = {},
) {
  return {
    from: "noreply@staging.gensoko.example",
    to: RECIPIENT,
    subject: "確認メール",
    text: MAIL_BODY,
    html: `<p>${MAIL_BODY}</p>`,
    ...overrides,
  };
}

async function expectSafeFailure(
  promise: Promise<unknown>,
  forbiddenValues: readonly string[] = [],
): Promise<void> {
  let thrown: unknown;
  try {
    await promise;
  } catch (error) {
    thrown = error;
  }

  expect(thrown).toBeInstanceOf(Error);
  expect((thrown as Error).message).toBe(MAIL_DELIVERY_ERROR_MESSAGE);
  const serializedError = JSON.stringify(thrown);
  for (const value of forbiddenValues) {
    expect((thrown as Error).message).not.toContain(value);
    expect(serializedError).not.toContain(value);
  }
}

describe("createFetchMailSender", () => {
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("型付きconfigからHTTPS provider requestを組み立て、成功responseを検証する", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      Response.json({
        id: "provider-message-id",
      }),
    );
    const sender = createFetchMailSender(createConfig(), {
      fetch: fetchMock as typeof fetch,
    });

    await expect(sender.send(createMessage())).resolves.toBeUndefined();

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://mail-api.example.invalid/send");
    expect(init).toMatchObject({
      method: "POST",
      headers: {
        Authorization: `Bearer ${API_KEY}`,
        "Content-Type": "application/json",
      },
    });
    expect(init.signal).toBeInstanceOf(AbortSignal);
    expect(JSON.parse(String(init.body))).toEqual({
      from: "noreply@staging.gensoko.example",
      to: RECIPIENT,
      subject: "確認メール",
      text: MAIL_BODY,
      html: `<p>${MAIL_BODY}</p>`,
    });
  });

  it("staging allowlist外の宛先はprovider呼出し前に固定errorで拒否する", async () => {
    const fetchMock = vi.fn();
    const outsideRecipient = "outside@example.invalid";
    const sender = createFetchMailSender(createConfig(), {
      fetch: fetchMock as typeof fetch,
    });

    await expectSafeFailure(sender.send(createMessage({ to: outsideRecipient })), [
      outsideRecipient,
      API_KEY,
      MAIL_BODY,
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("stagingでallowlistがないconfigはprovider呼出し前に固定errorで拒否する", async () => {
    const fetchMock = vi.fn();
    const sender = createFetchMailSender(createConfig({ allowedRecipients: null }), {
      fetch: fetchMock as typeof fetch,
    });

    await expectSafeFailure(sender.send(createMessage()), [RECIPIENT, API_KEY, MAIL_BODY]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("productionはallowlist未設定を許容し、同じfetch境界を使う", async () => {
    const fetchMock = vi.fn().mockResolvedValue(Response.json({ id: "provider-message-id" }));
    const config = createConfig({ allowedRecipients: null });
    const sender = createFetchMailSender(
      {
        ...config,
        target: "production",
      },
      {
        fetch: fetchMock as typeof fetch,
      },
    );

    await expect(sender.send(createMessage())).resolves.toBeUndefined();
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("設定済み送信元とmessageの送信元が異なる場合はproviderを呼ばない", async () => {
    const fetchMock = vi.fn();
    const sender = createFetchMailSender(createConfig(), {
      fetch: fetchMock as typeof fetch,
    });

    await expectSafeFailure(sender.send(createMessage({ from: "spoofed@example.invalid" })), [
      RECIPIENT,
      API_KEY,
      MAIL_BODY,
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("network errorをraw error・secret・本文・宛先なしの固定errorへ変換する", async () => {
    const rawProviderError = "provider failed api_key=sensitive-mail-api-key";
    const fetchMock = vi.fn().mockRejectedValue(new Error(rawProviderError));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const sender = createFetchMailSender(createConfig(), {
      fetch: fetchMock as typeof fetch,
    });

    await expectSafeFailure(sender.send(createMessage()), [
      rawProviderError,
      API_KEY,
      MAIL_BODY,
      RECIPIENT,
    ]);
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("provider非2xx responseのbodyを読まず固定errorへ変換する", async () => {
    const json = vi.fn().mockResolvedValue({
      error: "raw provider error with sensitive-mail-api-key",
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json,
    });
    const sender = createFetchMailSender(createConfig(), {
      fetch: fetchMock as typeof fetch,
    });

    await expectSafeFailure(sender.send(createMessage()), [API_KEY, MAIL_BODY, RECIPIENT]);
    expect(json).not.toHaveBeenCalled();
  });

  it.each([
    ["非JSON", () => Promise.reject(new SyntaxError("invalid JSON"))],
    ["不正schema", () => Promise.resolve({ message: "missing id" })],
  ])("provider 2xxの%s responseを固定errorへ変換する", async (_caseName, json) => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      status: 202,
      json,
    });
    const sender = createFetchMailSender(createConfig(), {
      fetch: fetchMock as typeof fetch,
    });

    await expectSafeFailure(sender.send(createMessage()), [API_KEY, MAIL_BODY, RECIPIENT]);
  });

  it("timeout時はfetchのAbortSignalをabortして固定errorへ変換する", async () => {
    vi.useFakeTimers();
    let receivedSignal: AbortSignal | null = null;
    const fetchMock = vi.fn((_url: string | URL | Request, init?: RequestInit) => {
      receivedSignal = init?.signal as AbortSignal;
      return new Promise<Response>((_resolve, reject) => {
        receivedSignal?.addEventListener("abort", () => {
          reject(new DOMException("provider request aborted with secret", "AbortError"));
        });
      });
    });
    const sender = createFetchMailSender(createConfig({ timeoutMs: 25 }), {
      fetch: fetchMock as typeof fetch,
    });

    const sendPromise = sender.send(createMessage());
    const failureExpectation = expectSafeFailure(sendPromise, [
      API_KEY,
      MAIL_BODY,
      RECIPIENT,
      "provider request aborted",
    ]);
    await vi.advanceTimersByTimeAsync(25);

    await failureExpectation;
    const fetchSignal = (fetchMock.mock.calls[0]?.[1] as RequestInit | undefined)?.signal;
    expect(fetchSignal).toBeInstanceOf(AbortSignal);
    expect(fetchSignal?.aborted).toBe(true);
  });

  it("HTTPS以外のURLはprovider呼出し前に固定errorで拒否する", async () => {
    const fetchMock = vi.fn();
    const sender = createFetchMailSender(
      createConfig({ apiUrl: "http://mail-api.example.invalid/send" }),
      {
        fetch: fetchMock as typeof fetch,
      },
    );

    await expectSafeFailure(sender.send(createMessage()), [API_KEY, MAIL_BODY, RECIPIENT]);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
