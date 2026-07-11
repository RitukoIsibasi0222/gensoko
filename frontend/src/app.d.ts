import type { AdminListPageState } from '$lib/admin/query';

// See https://svelte.dev/docs/kit/types#app.d.ts
// for information about these interfaces
declare global {
  namespace App {
    // interface Error {}
    // interface Locals {}
    // interface PageData {}
    interface PageState {
      adminUsers?: AdminListPageState;
      verifyEmailToken?: string;
      verifyEmailCompleted?: boolean;
      verifyEmailAlreadyVerified?: boolean;
    }
    // interface Platform {}
  }
}

export {};
