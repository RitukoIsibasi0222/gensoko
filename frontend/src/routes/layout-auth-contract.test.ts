import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

const layoutSource = readFileSync(resolve(process.cwd(), 'src/routes/+layout.svelte'), 'utf8');

describe('root layout auth unavailable contract', () => {
  it('通信障害をrole=alertで表示し、明示retryとfocus対象を持つ', () => {
    expect(layoutSource).toContain('authStore.isUnavailable');
    expect(layoutSource).toContain('role="alert"');
    expect(layoutSource).toContain('authStore.retryInitialize');
    expect(layoutSource).toContain('tabindex="-1"');
    expect(layoutSource).toContain('.focus()');
  });
});
