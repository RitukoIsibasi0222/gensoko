const DEVELOPMENT_FRONTEND_URL = "http://localhost:5174";
const FRONTEND_URL_REQUIRED_MESSAGE = "production環境ではFRONTEND_URLの設定が必要です";

export type FrontendUrlOptions = {
  isProduction?: boolean;
};

/**
 * CORSとメールURLで共有するfrontend URLを返す。
 * productionではlocalhostへの暗黙fallbackを禁止し、設定漏れを起動時に検出する。
 */
export function getFrontendUrl({
  isProduction = process.env.NODE_ENV === "production",
}: FrontendUrlOptions = {}): string {
  const frontendUrl = process.env.FRONTEND_URL?.trim();

  if (frontendUrl) {
    return frontendUrl;
  }

  if (isProduction) {
    throw new Error(FRONTEND_URL_REQUIRED_MESSAGE);
  }

  return DEVELOPMENT_FRONTEND_URL;
}
