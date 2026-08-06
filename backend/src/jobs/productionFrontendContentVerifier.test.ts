import { existsSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { fileURLToPath } from "node:url";

import { describe, expect, it, vi } from "vitest";

const VERIFIER_PATH = fileURLToPath(
  new URL("../../../frontend/scripts/verify-production-frontend-content.mjs", import.meta.url),
);

type VerifyProduction = (options: {
  candidateUrl: string;
  domainUrl: string;
  smokeMarker: string;
  bypassSecret: string;
  fetchImpl: typeof fetch;
}) => Promise<boolean>;

async function verifier(): Promise<VerifyProduction> {
  expect(existsSync(VERIFIER_PATH)).toBe(true);
  const module = (await import(pathToFileURL(VERIFIER_PATH).href)) as {
    verifyProductionFrontendContent: VerifyProduction;
  };
  return module.verifyProductionFrontendContent;
}

function htmlResponse(url: string, assetHash = "same", marker = "Gensoko"): Response {
  const response = new Response(
    `<html><head><link href="/_app/immutable/assets/app.${assetHash}.css" rel="stylesheet"><script src="/_app/immutable/chunks/app.${assetHash}.js"></script></head><body>${marker}</body></html>`,
    { status: 200, headers: { "content-type": "text/html; charset=utf-8" } },
  );
  Object.defineProperty(response, "url", { value: url });
  return response;
}

describe("production frontend content verifier", () => {
  it("promote前candidateはcustom domainと比較せずmarker・assetを単体検証する", async () => {
    expect(existsSync(VERIFIER_PATH)).toBe(true);
    const module = (await import(pathToFileURL(VERIFIER_PATH).href)) as {
      verifyProductionFrontendCandidate: (
        options: Omit<Parameters<VerifyProduction>[0], "domainUrl">,
      ) => Promise<boolean>;
    };
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse("https://gensoko-production-candidate.vercel.app/"),
      ) as unknown as typeof fetch;
    await expect(
      module.verifyProductionFrontendCandidate({
        candidateUrl: "https://gensoko-production-candidate.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "production-bypass-secret",
        fetchImpl,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
    expect(fetchImpl).toHaveBeenCalledWith(
      "https://gensoko-production-candidate.vercel.app/",
      expect.objectContaining({
        headers: expect.objectContaining({
          "x-vercel-protection-bypass": "production-bypass-secret",
        }),
      }),
    );
  });

  it("production bypass Secretが空または空白を含む場合はfetch前に拒否する", async () => {
    expect(existsSync(VERIFIER_PATH)).toBe(true);
    const module = (await import(pathToFileURL(VERIFIER_PATH).href)) as {
      verifyProductionFrontendCandidate: (
        options: Omit<Parameters<VerifyProduction>[0], "domainUrl">,
      ) => Promise<boolean>;
    };
    const fetchImpl = vi.fn() as unknown as typeof fetch;

    await expect(
      module.verifyProductionFrontendCandidate({
        candidateUrl: "https://gensoko-production-candidate.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "",
        fetchImpl,
      }),
    ).resolves.toBe(false);
    await expect(
      module.verifyProductionFrontendCandidate({
        candidateUrl: "https://gensoko-production-candidate.vercel.app/",
        smokeMarker: "Gensoko",
        bypassSecret: "invalid bypass",
        fetchImpl,
      }),
    ).resolves.toBe(false);
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("production candidateとcustom domainのasset・marker一致をGETだけで確認する", async () => {
    const verifyProductionFrontendContent = await verifier();
    const fetchImpl = vi
      .fn()
      .mockResolvedValueOnce(htmlResponse("https://gensoko-production-candidate.vercel.app/"))
      .mockResolvedValueOnce(
        htmlResponse("https://www.gensoko.example.co/"),
      ) as unknown as typeof fetch;

    await expect(
      verifyProductionFrontendContent({
        candidateUrl: "https://gensoko-production-candidate.vercel.app/",
        domainUrl: "https://www.gensoko.example.co/",
        smokeMarker: "Gensoko",
        bypassSecret: "production-bypass-secret",
        fetchImpl,
      }),
    ).resolves.toBe(true);
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it("staging domain・同一URL・asset不一致・redirectを拒否する", async () => {
    const verifyProductionFrontendContent = await verifier();
    const invalidFetch = vi
      .fn()
      .mockResolvedValueOnce(
        htmlResponse("https://gensoko-production-candidate.vercel.app/", "new"),
      )
      .mockResolvedValueOnce(
        htmlResponse("https://www.gensoko.example.co/", "old"),
      ) as unknown as typeof fetch;

    await expect(
      verifyProductionFrontendContent({
        candidateUrl: "https://gensoko-production-candidate.vercel.app/",
        domainUrl: "https://www.gensoko.example.co/",
        smokeMarker: "Gensoko",
        bypassSecret: "production-bypass-secret",
        fetchImpl: invalidFetch,
      }),
    ).resolves.toBe(false);
    await expect(
      verifyProductionFrontendContent({
        candidateUrl: "https://gensoko-frontend-staging-develop.vercel.app/",
        domainUrl: "https://www.gensoko.example.co/",
        smokeMarker: "Gensoko",
        bypassSecret: "production-bypass-secret",
        fetchImpl: vi.fn() as unknown as typeof fetch,
      }),
    ).resolves.toBe(false);
  });
});
