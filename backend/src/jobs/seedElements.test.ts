import type { Element } from "@prisma/client";
import { describe, expect, it, vi } from "vitest";

import { ELEMENT_SEED } from "../lib/elements/seed-data.js";
import { ElementSeedStateError, seedElements, verifyElementSeed } from "./seedElements.js";

function cloneElements(elements: readonly Element[]): Element[] {
  return elements.map((element) => ({ ...element }));
}

function createMemoryClient(initialElements: readonly Element[] = []) {
  const state = cloneElements(initialElements);
  const findMany = vi.fn(async () => cloneElements(state).sort((a, b) => a.id - b.id));
  const upsert = vi.fn(
    async ({
      where,
      update,
      create,
    }: {
      where: { id: number };
      update: Element;
      create: Element;
    }) => {
      const index = state.findIndex((element) => element.id === where.id);
      if (index === -1) {
        state.push({ ...create });
      } else {
        state[index] = { ...update };
      }
      return { ...create };
    },
  );

  return { client: { element: { findMany, upsert } }, findMany, state, upsert };
}

describe("seedElements", () => {
  it("正本は1から118まで重複のない118元素である", () => {
    expect(ELEMENT_SEED).toHaveLength(118);
    expect(ELEMENT_SEED.map(({ id }) => id)).toEqual(
      Array.from({ length: 118 }, (_, index) => index + 1),
    );
    expect(new Set(ELEMENT_SEED.map(({ symbol }) => symbol)).size).toBe(118);
  });

  it("空のElementを正本118件へseedする", async () => {
    const { client, state, upsert } = createMemoryClient();

    await expect(seedElements(client)).resolves.toEqual({ count: 118 });
    expect(upsert).toHaveBeenCalledTimes(118);
    expect(state.sort((a, b) => a.id - b.id)).toEqual(ELEMENT_SEED);
  });

  it("正規118件へ再実行しても件数と内容を変えない", async () => {
    const { client, state, upsert } = createMemoryClient();

    await seedElements(client);
    await seedElements(client);

    expect(upsert).toHaveBeenCalledTimes(236);
    expect(state).toHaveLength(118);
    expect(state.sort((a, b) => a.id - b.id)).toEqual(ELEMENT_SEED);
  });

  it("一部だけ存在する不明状態はupsert前に拒否する", async () => {
    const { client, upsert } = createMemoryClient(ELEMENT_SEED.slice(0, 1));

    await expect(seedElements(client)).rejects.toBeInstanceOf(ElementSeedStateError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("118件でも正本と異なる状態はupsert前に拒否する", async () => {
    const modified = cloneElements(ELEMENT_SEED);
    modified[0] = { ...modified[0], nameJa: "不正な値" };
    const { client, upsert } = createMemoryClient(modified);

    await expect(seedElements(client)).rejects.toBeInstanceOf(ElementSeedStateError);
    expect(upsert).not.toHaveBeenCalled();
  });

  it("upsert後の118件完全一致を確認できなければ失敗する", async () => {
    const findMany = vi
      .fn()
      .mockResolvedValueOnce([])
      .mockResolvedValueOnce(cloneElements(ELEMENT_SEED.slice(0, 117)));
    const upsert = vi.fn().mockResolvedValue({});

    await expect(seedElements({ element: { findMany, upsert } })).rejects.toBeInstanceOf(
      ElementSeedStateError,
    );
  });
});

describe("verifyElementSeed", () => {
  it("別読取で正本118件を確認する", async () => {
    const { client } = createMemoryClient(ELEMENT_SEED);

    await expect(verifyElementSeed(client)).resolves.toEqual({ count: 118 });
  });

  it("不足・余分・field不一致を成功扱いにしない", async () => {
    const { client } = createMemoryClient(ELEMENT_SEED.slice(0, 117));

    await expect(verifyElementSeed(client)).rejects.toBeInstanceOf(ElementSeedStateError);
  });
});
