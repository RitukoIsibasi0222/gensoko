// Vitest resolves the public 'svelte' export to the server entry in this SvelteKit setup.
// Keep the client runtime escape hatch in one test utility instead of repeating internal paths.
// @ts-expect-error - Svelte does not publish declarations for this client runtime entry.
export { mount, unmount } from '../../../node_modules/svelte/src/index-client.js';
