import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  createPrismaClient: vi.fn(),
  getDatabaseUrl: vi.fn(),
}));

vi.mock("./config.js", () => ({
  getDatabaseUrl: mocks.getDatabaseUrl,
}));

vi.mock("./prisma-client.js", () => ({
  createPrismaClient: mocks.createPrismaClient,
}));

describe("Node Prisma singleton wiring", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.resetModules();
  });

  it("検証済みDATABASE_URLだけをclient factoryへ渡す", async () => {
    const databaseUrl = "postgresql://validated.example/gensoko";
    const client = { kind: "node-prisma-client" };
    mocks.getDatabaseUrl.mockReturnValue(databaseUrl);
    mocks.createPrismaClient.mockReturnValue(client);

    const module = await import("./prisma.js");

    expect(mocks.getDatabaseUrl).toHaveBeenCalledOnce();
    expect(mocks.createPrismaClient).toHaveBeenCalledWith(databaseUrl);
    expect(module.prisma).toBe(client);
  });

  it("DATABASE_URL検証失敗時はclient factoryを呼ばない", async () => {
    mocks.getDatabaseUrl.mockImplementation(() => {
      throw new Error("DATABASE_URLの設定が必要です");
    });

    await expect(import("./prisma.js")).rejects.toThrow("DATABASE_URLの設定が必要です");
    expect(mocks.createPrismaClient).not.toHaveBeenCalled();
  });
});
