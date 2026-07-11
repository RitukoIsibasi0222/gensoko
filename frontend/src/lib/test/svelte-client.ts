// Vitest resolves the public 'svelte' export to the server entry in this SvelteKit setup.
// Keep the client runtime escape hatch in one test utility instead of repeating internal paths.
type SvelteClientRuntime = Pick<
  typeof import('svelte'),
  'mount' | 'unmount' | 'onDestroy' | 'tick'
>;

const clientRuntime =
  // @ts-expect-error - Svelte does not publish declarations for this client runtime entry.
  (await import('../../../node_modules/svelte/src/index-client.js')) as SvelteClientRuntime;

export const mount = clientRuntime.mount;
export const unmount = clientRuntime.unmount;
export const onDestroy = clientRuntime.onDestroy;
export const tick = clientRuntime.tick;
