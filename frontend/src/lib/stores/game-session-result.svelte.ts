import type { GameSessionResponse } from '$lib/game/types';

type StoredGameSessionResult = {
  userId: string;
  result: GameSessionResponse;
};

class GameSessionResultStore {
  #storedResult = $state<StoredGameSessionResult | null>(null);

  get result(): GameSessionResponse | null {
    return this.#storedResult?.result ?? null;
  }

  set(result: GameSessionResponse, userId: string): void {
    this.#storedResult = { result, userId };
  }

  matches(sessionId: string | null, userId: string | null): boolean {
    return (
      sessionId !== null &&
      userId !== null &&
      this.#storedResult?.result.sessionId === sessionId &&
      this.#storedResult.userId === userId
    );
  }

  clear(): void {
    this.#storedResult = null;
  }
}

export const gameSessionResultStore = new GameSessionResultStore();
