<script lang="ts">
  import { page } from '$app/state';
  import { onDestroy, onMount } from 'svelte';
  import GameChoiceButton from '$lib/components/game/GameChoiceButton.svelte';
  import GameFeedbackPanel from '$lib/components/game/GameFeedbackPanel.svelte';
  import GameProgressIndicator from '$lib/components/game/GameProgressIndicator.svelte';
  import GameTimerBar from '$lib/components/game/GameTimerBar.svelte';
  import { ANSWER_FEEDBACK_MS, QUESTION_TIME_LIMIT_SEC } from '$lib/game/constants';
  import { getMockGameQuestions } from '$lib/game/mock-questions';
  import {
    buildAnswerDraft,
    getNextQuestionIndex,
    normalizeGameModeParam,
    summarizeAnswers
  } from '$lib/game/play';
  import type { GameAnswerDraft, GameMode, GamePlayPhase } from '$lib/game/types';
  import { getGameModeConfig } from '$lib/game/modes';
  import { authStore } from '$lib/stores/auth.svelte';

  let currentIndex = $state(0);
  let remainingSec = $state(QUESTION_TIME_LIMIT_SEC);
  let phase = $state<GamePlayPhase>('answering');
  let answers = $state<GameAnswerDraft[]>([]);
  let selectedAnswer = $state<GameAnswerDraft | null>(null);
  let lastMode = $state<GameMode | null>(null);
  let timerId: ReturnType<typeof setInterval> | null = null;
  let feedbackTimerId: ReturnType<typeof setTimeout> | null = null;
  let questionStartedAtMs: number | null = null;

  const mode = $derived(normalizeGameModeParam(page.url.searchParams.get('mode')));
  const modeConfig = $derived(mode === null ? null : getGameModeConfig(mode));
  const questions = $derived(mode === null ? [] : getMockGameQuestions(mode));
  const currentQuestion = $derived(questions[currentIndex] ?? null);
  const summary = $derived(summarizeAnswers(answers));
  const correctChoiceText = $derived(
    currentQuestion?.choices.find((choice) => choice.choiceId === currentQuestion.correctChoiceId)
      ?.text ?? null
  );
  const canAnswer = $derived(
    !authStore.isInitializing &&
      authStore.isLoggedIn &&
      mode !== null &&
      currentQuestion !== null &&
      phase === 'answering'
  );

  $effect(() => {
    if (mode === lastMode) {
      return;
    }

    lastMode = mode;
    resetGame();
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
    currentIndex = 0;
    remainingSec = QUESTION_TIME_LIMIT_SEC;
    phase = 'answering';
    answers = [];
    selectedAnswer = null;
    questionStartedAtMs = null;
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
    const answer = buildAnswerDraft({
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
  {:else if phase === 'completed'}
    <section class="space-y-5 rounded border border-gray-200 bg-white p-6">
      <div>
        <p class="text-sm font-semibold text-gray-500">4択クイズ</p>
        <h1 class="mt-2 text-2xl font-bold text-gray-900">ゲーム完了</h1>
        <p class="mt-2 text-sm leading-6 text-gray-600">
          {modeConfig.title}（{modeConfig.difficultyLabel}）を最後まで回答しました。
        </p>
      </div>

      <div class="grid gap-3 sm:grid-cols-2">
        <div class="rounded border border-gray-200 bg-gray-50 p-4">
          <p class="text-sm text-gray-600">正解数</p>
          <p class="mt-1 text-2xl font-bold text-gray-900">
            {summary.correctCount} / {summary.totalCount}
          </p>
        </div>
        <div class="rounded border border-gray-200 bg-gray-50 p-4">
          <p class="text-sm text-gray-600">正答率</p>
          <p class="mt-1 text-2xl font-bold text-gray-900">
            {summary.totalCount === 0
              ? 0
              : Math.round((summary.correctCount / summary.totalCount) * 100)}%
          </p>
        </div>
      </div>

      <p class="text-sm text-gray-600">
        スコア保存と結果画面は後続タスクで API と接続して実装します。
      </p>

      <div class="flex flex-wrap gap-3">
        <button
          type="button"
          onclick={resetGame}
          class="bg-brand hover:bg-brand-hover focus-visible:outline-brand inline-flex items-center justify-center rounded px-4 py-2 text-sm font-semibold text-white focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          もう一度
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
              correctChoiceId={phase === 'feedback' ? currentQuestion.correctChoiceId : null}
              showResult={phase === 'feedback'}
              onChoose={submitAnswer}
            />
          {/each}
        </div>
      </section>

      <GameFeedbackPanel answer={selectedAnswer} {correctChoiceText} />
    </section>
  {/if}
</div>
