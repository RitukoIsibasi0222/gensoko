import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ApiError } from '$lib/api/errors';
import { mount, unmount } from '$lib/test/svelte-client';

vi.mock('svelte', async () => await import('$lib/test/svelte-client'));

const mocks = vi.hoisted(() => ({
  getGameQuestions: vi.fn(),
  submitGameSession: vi.fn(),
  goto: vi.fn(),
  setResult: vi.fn(),
  toastFromApiError: vi.fn(),
  toastError: vi.fn(),
  page: {
    url: new URL('http://localhost/game/play?mode=SYMBOL_TO_NAME_LV1')
  }
}));

vi.mock('$app/navigation', () => ({ goto: mocks.goto }));
vi.mock('$app/state', () => ({ page: mocks.page }));
vi.mock('$lib/api/game', () => ({
  getGameQuestions: mocks.getGameQuestions,
  submitGameSession: mocks.submitGameSession
}));
vi.mock('$lib/game/constants', async (importOriginal) => {
  const actual = await importOriginal<typeof import('$lib/game/constants')>();
  return { ...actual, ANSWER_FEEDBACK_MS: 0 };
});
vi.mock('$lib/stores/auth.svelte', () => ({
  authStore: {
    isInitializing: false,
    isLoggedIn: true,
    accessToken: 'access-token',
    user: { id: 'user-1', username: 'user', role: 'USER' }
  }
}));
vi.mock('$lib/stores/game-session-result.svelte', () => ({
  gameSessionResultStore: { set: mocks.setResult }
}));
vi.mock('$lib/stores/toast.svelte', () => ({
  toastStore: {
    fromApiError: mocks.toastFromApiError,
    error: mocks.toastError
  }
}));

import GamePlayPage from './+page.svelte';

const RATE_LIMIT_MESSAGE = 'rate limit response message';
const QUESTION_RESPONSE = {
  questionSetId: 'question-set-1',
  expiresAt: '2026-06-20T12:30:00.000Z',
  questions: [
    {
      questionId: 'q1',
      prompt: 'H',
      choices: [
        { choiceId: '1', text: 'choice-1' },
        { choiceId: '2', text: 'choice-2' },
        { choiceId: '3', text: 'choice-3' },
        { choiceId: '4', text: 'choice-4' }
      ]
    }
  ]
};

let mounted: ReturnType<typeof mount> | null = null;

function mountPage(): HTMLDivElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  mounted = mount(GamePlayPage, { target });
  return target;
}

beforeEach(() => {
  vi.clearAllMocks();
  mocks.getGameQuestions.mockResolvedValue(QUESTION_RESPONSE);
});

afterEach(async () => {
  if (mounted) {
    await unmount(mounted);
    mounted = null;
  }
  document.body.replaceChildren();
});

describe('/game/play rate limit accessibility', () => {
  it('announces a question-load 429 and keeps a native retry button available', async () => {
    mocks.getGameQuestions.mockRejectedValue(
      new ApiError(429, RATE_LIMIT_MESSAGE, { error: RATE_LIMIT_MESSAGE })
    );
    const target = mountPage();

    await vi.waitFor(() => {
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(RATE_LIMIT_MESSAGE);
    });

    const retryButton = target.querySelector('button');
    expect(retryButton).toBeInstanceOf(HTMLButtonElement);
    expect(retryButton?.disabled).toBe(false);
  });

  it('announces a session-submit 429 and exposes enabled retry and restart controls', async () => {
    mocks.submitGameSession.mockRejectedValue(
      new ApiError(429, RATE_LIMIT_MESSAGE, { error: RATE_LIMIT_MESSAGE })
    );
    const target = mountPage();

    await vi.waitFor(() => {
      expect(target.querySelectorAll('button').length).toBeGreaterThanOrEqual(4);
    });
    (target.querySelector('button') as HTMLButtonElement).click();

    await vi.waitFor(() => {
      expect(mocks.submitGameSession).toHaveBeenCalledOnce();
      expect(target.querySelector('[role="alert"]')?.textContent).toContain(RATE_LIMIT_MESSAGE);
    });

    const controls = Array.from(target.querySelectorAll('button'));
    const [retryButton, restartButton] = controls;
    expect(retryButton?.disabled).toBe(false);
    expect(restartButton?.disabled).toBe(false);
  });
});
