import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const VERIFIER_PATH = fileURLToPath(
  new URL("../../../frontend/scripts/verify-staging-frontend-content.mjs", import.meta.url),
);

type VerifyOptions = {
  candidateUrl: string;
  domainUrl: string;
  smokeMarker: string;
  bypassSecret: string;
  fetchImpl: typeof fetch;
};

type VerifierModule = {
  verifyStagingFrontendContent: (options: VerifyOptions) => Promise<boolean>;
};

async function verifier(): Promise<VerifierModule> {
  expect(existsSync(VERIFIER_PATH)).toBe(true);
  return (await import(pathToFileURL(VERIFIER_PATH).href)) as VerifierModule;
}

function htmlResponse(url: string, html: string): Response {
  const response = new Response(html, {
    status: 200,
    headers: { "content-type": "text/html; charset=utf-8" },
  });
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("staging frontend content verifier", () => {
  it("candidateと固定domainのHTMLが一致する場合だけ成功する", async () => {
    const { verifyStagingFrontendContent } = await verifier();
    const html = "<html><title>Gensoko</title></html>";
    const fetchMock = vi.fn(async (input: string | URL | Request, _init?: RequestInit) =>
      htmlResponse(String(input), html),
    );
    const fetchImpl = fetchMock as unknown as typeof fetch;

    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://gensoko-candidate.vercel.app/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "bypass-secret",
        fetchImpl,
      }),
    ).resolves.toBe(true);

    expect(fetchMock).toHaveBeenCalledTimes(2);
    for (const [, init] of fetchMock.mock.calls) {
      expect(init).toMatchObject({
        cache: "no-store",
        redirect: "error",
        headers: {
          "cache-control": "no-cache",
          "x-vercel-protection-bypass": "bypass-secret",
        },
      });
    }
  });

  it("HTML不一致・非HTML・不正URLをfalseへ寄せる", async () => {
    const { verifyStagingFrontendContent } = await verifier();
    const mismatchFetch = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse("https://gensoko-candidate.vercel.app/", "<html>Gensoko candidate</html>"),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          "https://gensoko-frontend-staging-develop.vercel.app/",
          "<html>Gensoko old</html>",
        ),
      ) as unknown as typeof fetch;

    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://gensoko-candidate.vercel.app/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl: mismatchFetch,
      }),
    ).resolves.toBe(false);

    const nonHtmlFetch = vi.fn(async (input: string | URL | Request) => {
      const response = new Response('{"name":"Gensoko"}', {
        status: 200,
        headers: { "content-type": "application/json" },
      });
      Object.defineProperty(response, "url", { value: String(input) });
      return response;
    }) as unknown as typeof fetch;
    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://gensoko-candidate.vercel.app/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl: nonHtmlFetch,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://example.com/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).resolves.toBe(false);

    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).resolves.toBe(false);
  });
});
