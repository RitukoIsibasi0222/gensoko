const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
const FRONTEND_URL_REQUIRED_MESSAGE = "production環境ではFRONTEND_URLの設定が必要です";
const FRONTEND_URL_INVALID_MESSAGE = "FRONTEND_URLはHTTP(S)のオリジン形式で設定してください";

export type FrontendUrlOptions = {
  isProduction?: boolean;
};

function parseFrontendOrigin(value: string): string {
  let url: URL;

  try {
    url = new URL(value);
  } catch {
    throw new Error(FRONTEND_URL_INVALID_MESSAGE);
  }

  const isHttpOrigin = url.protocol === "http:" || url.protocol === "https:";
  const hasOnlyOrigin =
    url.username === "" &&
    url.password === "" &&
    url.pathname === "/" &&
    url.search === "" &&
    url.hash === "";

  if (!isHttpOrigin || !hasOnlyOrigin) {
    throw new Error(FRONTEND_URL_INVALID_MESSAGE);
  }

  return url.origin;
}

/**
 * CORSとメールURLで共有するfrontend URLを返す。
 * productionではlocalhostへの暗黙fallbackを禁止し、設定漏れを起動時に検出する。
 */
export function getFrontendUrl({
  isProduction = process.env.NODE_ENV === "production",
}: FrontendUrlOptions = {}): string {
  const frontendUrl = process.env.FRONTEND_URL?.trim();

  if (frontendUrl) {
    return parseFrontendOrigin(frontendUrl);
  }

  if (isProduction) {
    throw new Error(FRONTEND_URL_REQUIRED_MESSAGE);
  }

  return DEVELOPMENT_FRONTEND_URL;
}
