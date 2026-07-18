import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import ts from "typescript";
import { describe, expect, it } from "vitest";

const SOURCE_ROOT = resolve(import.meta.dirname, "..");

const NON_REFERENCE_FILES = [
  "lib/usable-admin.ts",
  "services/admin.service.ts",
  "services/auth.service.ts",
  "services/ranking.service.ts",
  "services/admin-create.service.ts",
  "services/user.service.ts",
] as const;

function findUnsafeUserRowReturningWrites(source: string, file = "inline.ts"): string[] {
  const sourceFile = ts.createSourceFile(file, source, ts.ScriptTarget.Latest, true);
  const unsafeCalls: string[] = [];

  function inspect(node: ts.Node): void {
    if (
      ts.isCallExpression(node) &&
      ts.isPropertyAccessExpression(node.expression) &&
      ["create", "update", "delete"].includes(node.expression.name.text) &&
      ts.isPropertyAccessExpression(node.expression.expression) &&
      node.expression.expression.name.text === "user"
    ) {
      const argument = node.arguments[0];
      const hasExplicitSelect =
        argument !== undefined &&
        ts.isObjectLiteralExpression(argument) &&
        argument.properties.some(
          (property) =>
            (ts.isPropertyAssignment(property) && property.name.getText(sourceFile) === "select") ||
            (ts.isShorthandPropertyAssignment(property) && property.name.text === "select"),
        );
      if (!hasExplicitSelect) {
        unsafeCalls.push(
          `${node.expression.expression.getText(sourceFile)}.${node.expression.name.text}`,
        );
      }
    }
    ts.forEachChild(node, inspect);
  }

  inspect(sourceFile);
  return unsafeCalls;
}

describe("deletedAt non-reference contract", () => {
  it.each(NON_REFERENCE_FILES)("%s does not depend on the legacy database column", (file) => {
    const source = readFileSync(resolve(SOURCE_ROOT, file), "utf8");
    expect(source).not.toContain("deletedAt");
  });

  it("keeps the deprecated v1 response field synthesized at the route boundary", () => {
    const source = readFileSync(resolve(SOURCE_ROOT, "routes/admin/index.ts"), "utf8");
    expect(source).toContain("deletedAt: null");
  });

  it("accepts a shorthand select property as an explicit User write selection", () => {
    const source = "const select = { id: true }; await tx.user.update({ where, data, select });";

    expect(findUnsafeUserRowReturningWrites(source)).toEqual([]);
  });

  it.each(NON_REFERENCE_FILES)(
    "%s explicitly selects fields from User row-returning writes",
    (file) => {
      const source = readFileSync(resolve(SOURCE_ROOT, file), "utf8");
      expect(findUnsafeUserRowReturningWrites(source, file)).toEqual([]);
    },
  );
});
