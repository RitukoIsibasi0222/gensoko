import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it, vi } from "vitest";
import { createDurableObjectPasswordVerifier } from "../lib/durable-object-password-verifier.js";
import { hashPassword } from "../lib/password.js";
import { PasswordVerificationUnavailableError } from "../lib/password-verifier.js";
import type { PasswordVerifierDurableObject } from "./password-verifier.js";

type TestEnvironment = Readonly<{
  PASSWORD_VERIFIER: DurableObjectNamespace<PasswordVerifierDurableObject>;
}>;

function getNamespace(): DurableObjectNamespace<PasswordVerifierDurableObject> {
  return (env as unknown as TestEnvironment).PASSWORD_VERIFIER;
}

function getStub(objectName: string): DurableObjectStub<PasswordVerifierDurableObject> {
  const namespace = getNamespace();
  return namespace.get(namespace.idFromName(objectName));
}

describe("PasswordVerifierDurableObject", () => {
  it("cost 12 hashと一致するpasswordだけtrueを返す", async () => {
    const passwordHash = await hashPassword("Pass1234!");
    const stub = getStub("real-compare");

    await expect(stub.verify({ password: "Pass1234!", passwordHash })).resolves.toBe(true);
    await expect(stub.verify({ password: "WrongPass1!", passwordHash })).resolves.toBe(false);
  });

  it("password・hash・resultをstorageへ保存せずalarmを設定しない", async () => {
    const passwordHash = await hashPassword("Pass1234!");
    const stub = getStub("no-storage");

    await stub.verify({ password: "Pass1234!", passwordHash });

    await runInDurableObject(stub, async (_instance, state) => {
      await expect(state.storage.list()).resolves.toEqual(new Map());
      await expect(state.storage.getAlarm()).resolves.toBeNull();
    });
  });
});

describe("createDurableObjectPasswordVerifier", () => {
  it("accountごとにDOを選びpassword/hashだけをRPCへ渡す", async () => {
    const verify = vi.fn().mockResolvedValue(true);
    const namespace = {
      idFromName: vi.fn((name: string) => ({ name }) as never),
      get: vi.fn(() => ({ verify })),
    } as unknown as DurableObjectNamespace<PasswordVerifierDurableObject>;
    const verifier = createDurableObjectPasswordVerifier(namespace);
    const input = {
      userId: "account-a",
      password: "Pass1234!",
      passwordHash: "$2b$12$existinghash",
    };

    await expect(verifier.verify(input)).resolves.toBe(true);
    await expect(verifier.verify({ ...input, userId: "account-b" })).resolves.toBe(true);
    await expect(verifier.verify(input)).resolves.toBe(true);

    expect(namespace.idFromName).toHaveBeenNthCalledWith(1, "account-a");
    expect(namespace.idFromName).toHaveBeenNthCalledWith(2, "account-b");
    expect(namespace.idFromName).toHaveBeenNthCalledWith(3, "account-a");
    expect(verify).toHaveBeenCalledWith({
      password: input.password,
      passwordHash: input.passwordHash,
    });
  });

  it.each([
    ["RPC exception", () => Promise.reject(new Error("sensitive RPC failure"))],
    ["non-boolean result", () => Promise.resolve("true")],
  ])("%sを固定unavailable errorへ縮約する", async (_name, implementation) => {
    const namespace = {
      idFromName: () => ({}) as DurableObjectId,
      get: () => ({ verify: implementation }),
    } as unknown as DurableObjectNamespace<PasswordVerifierDurableObject>;

    const error = await createDurableObjectPasswordVerifier(namespace)
      .verify({
        userId: "account-a",
        password: "Pass1234!",
        passwordHash: "$2b$12$existinghash",
      })
      .catch((caught) => caught);

    expect(error).toBeInstanceOf(PasswordVerificationUnavailableError);
    expect(error).toMatchObject({ message: "パスワード照合を利用できません" });
    expect(error).not.toHaveProperty("cause");
    expect(String(error)).not.toContain("sensitive");
  });
});
