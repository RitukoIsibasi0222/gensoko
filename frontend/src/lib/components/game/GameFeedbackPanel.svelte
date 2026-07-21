<script lang="ts">
  import type { GameAnswerDraft } from '$lib/game/types';

  type Props = {
    answer: GameAnswerDraft | null;
    correctChoiceText: string | null;
  };

  let { answer, correctChoiceText }: Props = $props();

  const title = $derived(
    answer === null
      ? ''
      : answer.timedOut
        ? '時間切れです'
        : answer.isCorrect
          ? '正解です'
          : '不正解です'
  );
  const panelClass = $derived(
    answer?.isCorrect
      ? 'border-success-border bg-success-surface text-success-text'
      : 'border-danger-border bg-danger-surface text-danger-text-strong'
  );
</script>

{#if answer}
  <section class={`rounded border px-4 py-3 ${panelClass}`} role="status" aria-live="polite">
    <p class="text-base font-bold">{title}</p>
    {#if !answer.isCorrect && correctChoiceText}
      <p class="mt-1 text-sm">正解は「{correctChoiceText}」です。</p>
    {/if}
    <p class="mt-1 text-sm">回答時間: {answer.answerTimeSec}秒</p>
  </section>
{/if}
