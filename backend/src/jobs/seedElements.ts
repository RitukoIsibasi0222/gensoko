import type { Element, Prisma } from "@prisma/client";

import { ELEMENT_SEED } from "../lib/elements/seed-data.js";

const INVALID_STATE_MESSAGE = "元素データの状態を正本118件として確認できませんでした";

export type ElementSeedStateStage = "preflight" | "verification";

export interface ElementReadClient {
  element: {
    findMany(args: { orderBy: { id: "asc" } }): Promise<Element[]>;
  };
}

export interface ElementSeedClient extends ElementReadClient {
  element: ElementReadClient["element"] & {
    upsert(args: Prisma.ElementUpsertArgs): Promise<unknown>;
  };
}

export class ElementSeedStateError extends Error {
  constructor(public readonly stage: ElementSeedStateStage) {
    super(INVALID_STATE_MESSAGE);
    this.name = "ElementSeedStateError";
  }
}

function elementsMatch(actual: Element, expected: Element): boolean {
  return (
    actual.id === expected.id &&
    actual.symbol === expected.symbol &&
    actual.nameJa === expected.nameJa &&
    actual.nameEn === expected.nameEn &&
    actual.category === expected.category &&
    actual.period === expected.period &&
    actual.group === expected.group &&
    actual.atomicWeight === expected.atomicWeight &&
    actual.etymology === expected.etymology
  );
}

function isCanonicalElementSeed(elements: readonly Element[]): boolean {
  return (
    elements.length === ELEMENT_SEED.length &&
    elements.every((element, index) => elementsMatch(element, ELEMENT_SEED[index]))
  );
}

async function readElements(client: ElementReadClient): Promise<readonly Element[]> {
  return client.element.findMany({ orderBy: { id: "asc" } });
}

export async function verifyElementSeed(client: ElementReadClient): Promise<{ count: number }> {
  const elements = await readElements(client);
  if (!isCanonicalElementSeed(elements)) {
    throw new ElementSeedStateError("verification");
  }
  return { count: elements.length };
}

export async function seedElements(client: ElementSeedClient): Promise<{ count: number }> {
  const existingElements = await readElements(client);
  if (existingElements.length !== 0 && !isCanonicalElementSeed(existingElements)) {
    throw new ElementSeedStateError("preflight");
  }

  for (const element of ELEMENT_SEED) {
    await client.element.upsert({
      where: { id: element.id },
      update: element,
      create: element,
    });
  }

  return verifyElementSeed(client);
}
