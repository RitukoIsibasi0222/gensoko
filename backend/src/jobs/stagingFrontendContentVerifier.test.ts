import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const VERIFIER_PATH = fileURLToPath(
  new URL("../../../frontend/scripts/verify-staging-frontend-content.mjs", import.meta.url),
);
const COMMON_VERIFIER_PATH = fileURLToPath(
  new URL("../../../frontend/scripts/frontend-content-verifier.mjs", import.meta.url),
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
  expect(existsSync(COMMON_VERIFIER_PATH)).toBe(true);
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

function appHtml({
  assetOrigin = "",
  assetHash = "same-build",
  marker = "Gensoko",
  providerMarkup = "",
}: {
  assetOrigin?: string;
  assetHash?: string;
  marker?: string;
  providerMarkup?: string;
} = {}): string {
  return `<html><head>
    <link rel="stylesheet" href="${assetOrigin}/_app/immutable/assets/0.${assetHash}.css">
    <link rel="modulepreload" href="${assetOrigin}/_app/immutable/chunks/app.${assetHash}.js">
  </head><body>${marker}${providerMarkup}</body></html>`;
}

describe("staging frontend content verifier", () => {
  it("provider注入HTMLとoriginが異なってもapp asset fingerprint一致で成功する", async () => {
    const { verifyStagingFrontendContent } = await verifier();
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse(
          "https://gensoko-candidate.vercel.app/",
          appHtml({
            assetOrigin: "https://gensoko-candidate.vercel.app",
            providerMarkup:
              '<script src="https://vercel.live/_next-live/feedback/feedback.js"></script>',
          }),
        ),
      )
      .mockResolvedValueOnce(
        htmlResponse("https://gensoko-frontend-staging-develop.vercel.app/", appHtml()),
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

  it("app asset hash不一致・asset欠落・marker欠落をfalseへ寄せる", async () => {
    const { verifyStagingFrontendContent } = await verifier();
    const mismatchFetch = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse(
          "https://gensoko-candidate.vercel.app/",
          appHtml({ assetHash: "candidate-build" }),
        ),
      )
      .mockResolvedValueOnce(
        htmlResponse(
          "https://gensoko-frontend-staging-develop.vercel.app/",
          appHtml({ assetHash: "old-build" }),
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

    const noAssetsFetch = vi.fn(async (input: string | URL | Request) =>
      htmlResponse(String(input), "<html>Gensoko</html>"),
    ) as unknown as typeof fetch;
    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://gensoko-candidate.vercel.app/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl: noAssetsFetch,
      }),
    ).resolves.toBe(false);

    const missingMarkerFetch = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse("https://gensoko-candidate.vercel.app/", appHtml({ marker: "" })),
      )
      .mockResolvedValueOnce(
        htmlResponse("https://gensoko-frontend-staging-develop.vercel.app/", appHtml()),
      ) as unknown as typeof fetch;
    await expect(
      verifyStagingFrontendContent({
        candidateUrl: "https://gensoko-candidate.vercel.app/",
        domainUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl: missingMarkerFetch,
      }),
    ).resolves.toBe(false);
  });

  it("非HTML・不正URLをfalseへ寄せる", async () => {
    const { verifyStagingFrontendContent } = await verifier();
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
