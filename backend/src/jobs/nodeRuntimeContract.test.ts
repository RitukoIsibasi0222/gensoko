import { readFileSync, readdirSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";

const root = resolve(import.meta.dirname, "../../..");
const read = (path: string) => readFileSync(resolve(root, path), "utf8");

describe("Node security runtime contract", () => {
  it("pins the patched Node 22 runtime and aligns Docker", () => {
    const version = read(".node-version").trim();
    expect(version).toBe("22.23.4");
    expect(read("docker-compose.yml")).toContain(`node:${version}-alpine`);
    expect(read("docker-compose.yml")).not.toContain("node:22-alpine");
  });

  it("every setup-node step reads the shared version file", () => {
    const files = readdirSync(resolve(root, ".github"), { recursive: true }).filter(
      (file): file is string => typeof file === "string" && file.endsWith(".yml"),
    );
    let count = 0;
    for (const file of files) {
      const source = read(`.github/${file}`);
      const steps = source.split("uses: actions/setup-node@").slice(1);
      for (const step of steps) {
        const config = step.split(/\n\s+- (?:name:|uses:|run:)/)[0];
        expect(config, file).toContain("node-version-file: .node-version");
        expect(config, file).not.toMatch(/node-version:\s*22/);
        count++;
      }
    }
    expect(count).toBeGreaterThan(20);
  });
});
