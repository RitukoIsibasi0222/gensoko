import type { GameSessionResponse } from '$lib/game/types';

class GameSessionResultStore {
  #result = $state<GameSessionResponse | null>(null);

  get result(): GameSessionResponse | null {
    return this.#result;
  }

  set(result: GameSessionResponse): void {
    this.#result = result;
  }

  matches(sessionId: string | null): boolean {
    return sessionId !== null && this.#result?.sessionId === sessionId;
  }

  clear(): void {
    this.#result = null;
  }
}

export const gameSessionResultStore = new GameSessionResultStore();
