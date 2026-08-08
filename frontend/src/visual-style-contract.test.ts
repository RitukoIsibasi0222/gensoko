import { readFileSync, readdirSync } from 'node:fs';
import { extname, join, resolve } from 'node:path';

import { describe, expect, it } from 'vitest';

const frontendRoot = process.cwd();
const sourceRoot = resolve(frontendRoot, 'src');

function collectFiles(directory: string, extension: string): string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return collectFiles(path, extension);
    return extname(entry.name) === extension ? [path] : [];
  });
}

describe('visual style contract', () => {
  it('すべてのTailwind角丸トークンを4pxへ統一する', () => {
    const appCss = readFileSync(resolve(sourceRoot, 'app.css'), 'utf8');

    for (const token of [
      '--radius-xs',
      '--radius-sm',
      '--radius-md',
      '--radius-lg',
      '--radius-xl',
      '--radius-2xl',
      '--radius-3xl',
      '--radius-4xl'
    ]) {
      expect(appCss, token).toContain(`${token}: 0.25rem;`);
    }
  });

  it('4pxを超えるrounded-fullをSvelte UIに残さない', () => {
    const violations = collectFiles(sourceRoot, '.svelte')
      .filter((path) => readFileSync(path, 'utf8').includes('rounded-full'))
      .map((path) => path.replace(`${frontendRoot}/`, ''));

    expect(violations).toEqual([]);
  });

  it('カードにshadow-smを付与しない', () => {
    const violations = collectFiles(sourceRoot, '.svelte')
      .filter((path) => readFileSync(path, 'utf8').includes('shadow-sm'))
      .map((path) => path.replace(`${frontendRoot}/`, ''));

    expect(violations).toEqual([]);
  });
});
