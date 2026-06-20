<script lang="ts">
  import { goto } from '$app/navigation';
  import { page } from '$app/state';
  import { onDestroy, onMount } from 'svelte';
  import { ApiError } from '$lib/api/errors';
  import { getGameQuestions, submitGameSession } from '$lib/api/game';
  import GameChoiceButton from '$lib/components/game/GameChoiceButton.svelte';
  import GameProgressIndicator from '$lib/components/game/GameProgressIndicator.svelte';
  import GameTimerBar from '$lib/components/game/GameTimerBar.svelte';
  import {
    ANSWER_FEEDBACK_MS,
    GAME_SESSION_DURATION_LIMIT_SEC,
    QUESTION_TIME_LIMIT_SEC
  } from '$lib/game/constants';
  import {
    buildSessionAnswerDraft,
    calculateAnswerDurationSec,
    getNextQuestionIndex,
    normalizeGameModeParam
  } from '$lib/game/play';
  import type {
    GameApiQuestion,
    GameMode,
    GamePlayPhase,
    GameSessionAnswerDraft
  } from '$lib/game/types';
  import { getGameModeConfig } from '$lib/game/modes';
  import { authStore } from '$lib/stores/auth.svelte';
  import { gameSessionResultStore } from '$lib/stores/game-session-result.svelte';
  import { toastStore } from '$lib/stores/toast.svelte';

  type QuestionLoadStatus = 'idle' | 'loading' | 'loaded' | 'error';
  type SubmitStatus = 'idle' | 'submitting' | 'error';

  let currentIndex = $state(0);
  let remainingSec = $state(QUESTION_TIME_LIMIT_SEC);
  let phase = $state<GamePlayPhase>('answering');
  let answers = $state<GameSessionAnswerDraft[]>([]);
  let selectedAnswer = $state<GameSessionAnswerDraft | null>(null);
  let lastMode = $state<GameMode | null>(null);
  let questionSetId = $state<string | null>(null);
  let questions = $state<GameApiQuestion[]>([]);
  let questionLoadStatus = $state<QuestionLoadStatus>('idle');
  let questionLoadError = $state<string | null>(null);
  let questionRequestKey = $state<string | null>(null);
  let submitStatus = $state<SubmitStatus>('idle');
  let submitError = $state<string | null>(null);
  let timerId: ReturnType<typeof setInterval> | null = null;
  let feedbackTimerId: ReturnType<typeof setTimeout> | null = null;
  let questionAbortController: AbortController | null = null;
  let submitAbortController: AbortController | null = null;
  let questionStartedAtMs: number | null = null;

  const mode = $derived(normalizeGameModeParam(page.url.searchParams.get('mode')));
  const modeConfig = $derived(mode === null ? null : getGameModeConfig(mode));
  const currentQuestion = $derived(questions[currentIndex] ?? null);
  const isQuestionLoading = $derived(questionLoadStatus === 'loading');
  const isSubmitting = $derived(submitStatus === 'submitting');
  const canAnswer = $derived(
    !authStore.isInitializing &&
      authStore.isLoggedIn &&
      mode !== null &&
      currentQuestion !== null &&
      questionLoadStatus === 'loaded' &&
      phase === 'answering' &&
      !isSubmitting
  );

  $effect(() => {
    if (mode === lastMode) {
      return;
    }

    lastMode = mode;
    resetGame();
  });

  $effect(() => {
    const currentMode = mode;
    const accessToken = authStore.accessToken;

    if (authStore.isInitializing) {
      return;
    }

    if (!authStore.isLoggedIn || currentMode === null || accessToken === null) {
      questionRequestKey = null;
      abortQuestionLoad();
      resetQuestionState();
      return;
    }

    const nextRequestKey = `${currentMode}:${accessToken}`;
    if (questionRequestKey === nextRequestKey) {
      return;
    }

    questionRequestKey = nextRequestKey;
    void loadQuestions(currentMode, accessToken);
  });

  $effect(() => {
    if (!canAnswer) {
      stopTimer();
      return;
    }

    startTimer();

    return () => {
      stopTimer();
    };
  });

  function resetGame(): void {
    stopTimer();
    clearFeedbackTimer();
    abortSubmit();
    currentIndex = 0;
    remainingSec = QUESTION_TIME_LIMIT_SEC;
    phase = 'answering';
    answers = [];
    selectedAnswer = null;
    submitStatus = 'idle';
    submitError = null;
    questionStartedAtMs = null;
  }

  function resetQuestionState(): void {
    resetGame();
    questionSetId = null;
    questions = [];
    questionLoadStatus = 'idle';
    questionLoadError = null;
  }

  function abortQuestionLoad(): void {
    questionAbortController?.abort();
    questionAbortController = null;
  }

  function abortSubmit(): void {
    submitAbortController?.abort();
    submitAbortController = null;
  }

  function isAbortError(error: unknown): boolean {
    return (
      (error instanceof DOMException && error.name === 'AbortError') ||
      (error instanceof Error && error.name === 'AbortError')
    );
  }

  function getErrorMessage(error: unknown, fallback: string): string {
    return error instanceof ApiError ? error.message : fallback;
  }

  function showErrorToast(error: unknown, fallback: string): void {
    if (error instanceof ApiError) {
      toastStore.fromApiError(error);
      return;
    }

    toastStore.error(fallback);
  }

  async function loadQuestions(currentMode: GameMode, accessToken: string): Promise<void> {
    resetGame();
    abortQuestionLoad();
    const controller = new AbortController();
    questionAbortController = controller;
    questionSetId = null;
    questions = [];
    questionLoadStatus = 'loading';
    questionLoadError = null;

    try {
      const response = await getGameQuestions({
        mode: currentMode,
        accessToken,
        signal: controller.signal
      });

      if (controller.signal.aborted) {
        return;
      }

      if (response.questions.length === 0) {
        questionLoadStatus = 'error';
        questionLoadError = '出題できる問題がありません。';
        return;
      }

      questionSetId = response.questionSetId;
      questions = [...response.questions];
      questionLoadStatus = 'loaded';
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }

      const message = getErrorMessage(error, 'ゲーム問題の取得に失敗しました');
      questionLoadStatus = 'error';
      questionLoadError = message;
      showErrorToast(error, message);
    } finally {
      if (questionAbortController === controller) {
        questionAbortController = null;
      }
    }
  }

  function retryQuestionLoad(): void {
    if (mode === null || authStore.accessToken === null) {
      return;
    }

    questionRequestKey = null;
    void loadQuestions(mode, authStore.accessToken);
  }

  function restartGame(): void {
    retryQuestionLoad();
  }

  function startTimer(): void {
    stopTimer();
    questionStartedAtMs ??= Date.now();
    timerId = setInterval(() => {
      const nextRemainingSec = getCurrentRemainingSec();
      remainingSec = nextRemainingSec;

      if (nextRemainingSec === 0) {
        submitAnswer(null);
      }
    }, 250);
  }

  function stopTimer(): void {
    if (timerId !== null) {
      clearInterval(timerId);
      timerId = null;
    }
  }

  function clearFeedbackTimer(): void {
    if (feedbackTimerId !== null) {
      clearTimeout(feedbackTimerId);
      feedbackTimerId = null;
    }
  }

  function getCurrentRemainingSec(): number {
    if (questionStartedAtMs === null) {
      return QUESTION_TIME_LIMIT_SEC;
    }

    const elapsedSec = Math.floor((Date.now() - questionStartedAtMs) / 1000);
    return Math.max(QUESTION_TIME_LIMIT_SEC - elapsedSec, 0);
  }

  function scheduleNextStep(): void {
    clearFeedbackTimer();
    feedbackTimerId = setTimeout(() => {
      const nextIndex = getNextQuestionIndex(currentIndex, questions.length);

      if (nextIndex === null) {
        phase = 'completed';
        selectedAnswer = null;
        feedbackTimerId = null;
        void submitCompletedGame();
        return;
      }

      currentIndex = nextIndex;
      remainingSec = QUESTION_TIME_LIMIT_SEC;
      questionStartedAtMs = null;
      selectedAnswer = null;
      phase = 'answering';
      feedbackTimerId = null;
    }, ANSWER_FEEDBACK_MS);
  }

  function submitAnswer(choiceId: string | null): void {
    if (!canAnswer || currentQuestion === null) {
      return;
    }

    stopTimer();
    const answerRemainingSec = getCurrentRemainingSec();
    remainingSec = answerRemainingSec;
    const answer = buildSessionAnswerDraft({
      question: currentQuestion,
      chosenChoiceId: choiceId,
      remainingSec: answerRemainingSec,
      timeLimitSec: QUESTION_TIME_LIMIT_SEC
    });
    answers = [...answers, answer];
    selectedAnswer = answer;
    questionStartedAtMs = null;
    phase = 'feedback';
    scheduleNextStep();
  }

  async function submitCompletedGame(): Promise<void> {
    if (submitStatus === 'submitting') {
      return;
    }

    const accessToken = authStore.accessToken;
    const userId = authStore.user?.id ?? null;

    if (mode === null || accessToken === null || userId === null || questionSetId === null) {
      submitStatus = 'error';
      submitError = 'ゲーム結果の送信に必要な情報が不足しています。';
      return;
    }

    if (answers.length !== questions.length) {
      submitStatus = 'error';
      submitError = '回答数が問題数と一致していません。もう一度ゲームを開始してください。';
      return;
    }

    abortSubmit();
    const controller = new AbortController();
    submitAbortController = controller;
    submitStatus = 'submitting';
    submitError = null;

    try {
      const result = await submitGameSession({
        questionSetId,
        mode,
        answers,
        durationSec: calculateAnswerDurationSec(answers, GAME_SESSION_DURATION_LIMIT_SEC),
        accessToken,
        signal: controller.signal
      });

      if (controller.signal.aborted) {
        return;
      }

      gameSessionResultStore.set(result, userId);
      await goto(`/game/result?sessionId=${encodeURIComponent(result.sessionId)}`);
    } catch (error) {
      if (isAbortError(error) || controller.signal.aborted) {
        return;
      }

      const message = getErrorMessage(error, 'ゲーム結果の送信に失敗しました');
      submitStatus = 'error';
      submitError = message;
      showErrorToast(error, message);
    } finally {
      if (submitAbortController === controller) {
        submitAbortController = null;
      }
    }
  }

  function isEditableTarget(target: EventTarget | null): boolean {
    return (
      target instanceof HTMLInputElement ||
      target instanceof HTMLTextAreaElement ||
      target instanceof HTMLSelectElement ||
      (target instanceof HTMLElement && target.isContentEditable)
    );
  }

  function getChoiceIndexFromKey(event: KeyboardEvent): number | null {
    if (event.code.startsWith('Digit') || event.code.startsWith('Numpad')) {
      const index = Number(event.code.at(-1)) - 1;
      return Number.isInteger(index) && index >= 0 && index <= 3 ? index : null;
    }

    return null;
  }

  function handleKeydown(event: KeyboardEvent): void {
    if (!canAnswer || currentQuestion === null || isEditableTarget(event.target)) {
      return;
    }

    const choiceIndex = getChoiceIndexFromKey(event);
    const choice = choiceIndex === null ? undefined : currentQuestion.choices[choiceIndex];
    if (choice === undefined) {
      return;
    }

    event.preventDefault();
    submitAnswer(choice.choiceId);
  }

  onMount(() => {
    window.addEventListener('keydown', handleKeydown);

    return () => {
      window.removeEventListener('keydown', handleKeydown);
    };
  });

  onDestroy(() => {
    stopTimer();
    clearFeedbackTimer();
    abortQuestionLoad();
    abortSubmit();
  });
</script>

<div class="space-y-6">
  {#if authStore.isInitializing}
    <section class="rounded border border-gray-200 bg-white p-5" aria-busy="true">
      <p class="text-sm text-gray-600">ログイン状態を確認しています...</p>
    </section>
  {:else if !authStore.isLoggedIn}
    <section class="space-y-4 rounded border border-gray-200 bg-white p-6">
      <div>
        <p class="text-sm font-semibold text-gray-500">4択クイズ</p>
        <h1 class="mt-2 text-2xl font-bold text-gray-900">ログインが必要です</h1>
        <p class="mt-2 text-sm leading-6 text-gray-600">
          ゲームを開始するにはログインしてください。
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <a
          href="/login"
          class="bg-brand hover:bg-brand-hover focus-visible:outline-brand inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          ログインへ
        </a>
        <a
          href="/game"
          class="inline-flex items-center justify-center rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          モード選択へ戻る
        </a>
      </div>
    </section>
  {:else if mode === null || modeConfig === null}
    <section class="space-y-4 rounded border border-red-200 bg-red-50 p-6">
      <div>
        <p class="text-sm font-semibold text-red-700">ゲームを開始できません</p>
        <h1 class="mt-2 text-2xl font-bold text-red-900">ゲームモードが正しくありません</h1>
        <p class="mt-2 text-sm leading-6 text-red-800">
          モード選択画面から、もう一度ゲームを開始してください。
        </p>
      </div>
      <a
        href="/game"
        class="inline-flex items-center justify-center rounded bg-white px-4 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
      >
        モード選択へ戻る
      </a>
    </section>
  {:else if isQuestionLoading}
    <section
      class="rounded border border-gray-200 bg-white p-5"
      aria-busy="true"
      aria-live="polite"
    >
      <p class="text-sm text-gray-600">ゲーム問題を読み込んでいます...</p>
    </section>
  {:else if questionLoadStatus === 'error'}
    <section class="space-y-4 rounded border border-red-200 bg-red-50 p-6" aria-live="polite">
      <div>
        <p class="text-sm font-semibold text-red-700">ゲームを開始できません</p>
        <h1 class="mt-2 text-2xl font-bold text-red-900">問題の取得に失敗しました</h1>
        <p class="mt-2 text-sm leading-6 text-red-800">
          {questionLoadError ?? 'ゲーム問題の取得に失敗しました'}
        </p>
      </div>
      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          onclick={retryQuestionLoad}
          class="inline-flex items-center justify-center rounded bg-white px-4 py-2 text-sm font-semibold text-red-800 ring-1 ring-red-200 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          もう一度読み込む
        </button>
        <a
          href="/game"
          class="inline-flex items-center justify-center rounded border border-red-200 px-4 py-2 text-sm font-semibold text-red-800 hover:bg-red-100 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-red-600"
        >
          モード選択へ戻る
        </a>
      </div>
    </section>
  {:else if phase === 'completed'}
    <section
      class="space-y-5 rounded border border-gray-200 bg-white p-6"
      aria-busy={isSubmitting}
      aria-live="polite"
    >
      <div>
        <p class="text-sm font-semibold text-gray-500">4択クイズ</p>
        <h1 class="mt-2 text-2xl font-bold text-gray-900">
          {submitStatus === 'error' ? '結果を保存できませんでした' : '結果を保存しています'}
        </h1>
        <p class="mt-2 text-sm leading-6 text-gray-600">
          {modeConfig.title}（{modeConfig.difficultyLabel}）を最後まで回答しました。
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded border border-gray-200 bg-gray-50 p-4">
          <p class="text-sm text-gray-600">回答数</p>
          <p class="mt-1 text-2xl font-bold text-gray-900">{answers.length} / {questions.length}</p>
        </div>
        <div class="rounded border border-gray-200 bg-gray-50 p-4">
          <p class="text-sm text-gray-600">保存状態</p>
          <p class="mt-1 text-2xl font-bold text-gray-900">
            {submitStatus === 'error' ? '失敗' : '送信中'}
          </p>
        </div>
      </div>

      {#if submitStatus === 'error'}
        <div class="rounded border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-800">
          {submitError ?? 'ゲーム結果の送信に失敗しました'}
        </div>
      {:else}
        <p class="text-sm text-gray-600">サーバーで正誤判定とスコア計算を行っています...</p>
      {/if}

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          onclick={submitCompletedGame}
          disabled={isSubmitting}
          class="bg-brand hover:bg-brand-hover focus-visible:outline-brand inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          再送信
        </button>
        <button
          type="button"
          onclick={restartGame}
          disabled={isSubmitting}
          class="inline-flex items-center justify-center rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          新しく始める
        </button>
        <a
          href="/game"
          class="inline-flex items-center justify-center rounded border border-gray-300 px-4 py-2 text-sm font-semibold text-gray-700 hover:bg-gray-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)]"
        >
          モード選択へ戻る
        </a>
      </div>
    </section>
  {:else if currentQuestion}
    <section class="space-y-5" aria-labelledby="game-play-heading">
      <div class="space-y-2">
        <p class="text-sm font-semibold text-gray-500">4択クイズ</p>
        <h1 id="game-play-heading" class="text-2xl font-bold text-gray-900">
          {modeConfig.title}
        </h1>
        <p class="text-sm text-gray-600">
          {modeConfig.formatLabel} / {modeConfig.difficultyLabel} / {modeConfig.rangeLabel}
        </p>
      </div>

      <div class="grid gap-4 md:grid-cols-[1fr_220px]">
        <GameProgressIndicator
          {currentIndex}
          totalCount={questions.length}
          answeredCount={answers.length}
        />
        <GameTimerBar {remainingSec} timeLimitSec={QUESTION_TIME_LIMIT_SEC} />
      </div>

      <div class="rounded border border-gray-200 bg-white p-5 shadow-sm">
        <p class="text-sm font-semibold text-gray-500">問題</p>
        <p class="mt-3 text-center text-5xl font-bold break-words text-gray-900">
          {currentQuestion.prompt}
        </p>
      </div>

      <section class="space-y-3" aria-labelledby="choice-heading">
        <div class="flex flex-col gap-1 sm:flex-row sm:items-end sm:justify-between">
          <h2 id="choice-heading" class="text-lg font-bold text-gray-900">答えを選択</h2>
          <p class="text-sm text-gray-600">キーボードの 1〜4 でも回答できます。</p>
        </div>

        <div class="grid gap-3 sm:grid-cols-2">
          {#each currentQuestion.choices as choice, index (choice.choiceId)}
            <GameChoiceButton
              {choice}
              {index}
              disabled={!canAnswer}
              selectedChoiceId={selectedAnswer?.chosenChoiceId ?? null}
              correctChoiceId={null}
              showResult={phase === 'feedback'}
              onChoose={submitAnswer}
            />
          {/each}
        </div>
      </section>

      {#if selectedAnswer}
        <section
          class="rounded border border-sky-200 bg-sky-50 px-4 py-3 text-sky-900"
          role="status"
          aria-live="polite"
        >
          <p class="text-base font-bold">
            {selectedAnswer.chosenChoiceId === null
              ? '未回答として記録しました'
              : '回答を記録しました'}
          </p>
          <p class="mt-1 text-sm">回答時間: {selectedAnswer.answerTimeSec}秒</p>
        </section>
      {/if}
    </section>
  {/if}
</div>
