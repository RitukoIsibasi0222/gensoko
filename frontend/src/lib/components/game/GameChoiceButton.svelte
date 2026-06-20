<script lang="ts">
  import type { GameChoice, GameChoiceHandler } from '$lib/game/types';

  type Props = {
    choice: GameChoice;
    index: number;
    disabled: boolean;
    selectedChoiceId: string | null;
    correctChoiceId: string | null;
    showResult: boolean;
    onChoose: GameChoiceHandler;
  };

  let { choice, index, disabled, selectedChoiceId, correctChoiceId, showResult, onChoose }: Props =
    $props();

  const isSelected = $derived(selectedChoiceId === choice.choiceId);
  const isCorrectChoice = $derived(correctChoiceId === choice.choiceId);
  const resultLabel = $derived(
    showResult && isCorrectChoice
      ? '正解'
      : showResult && isSelected && correctChoiceId === null
        ? '回答済み'
        : showResult && isSelected
          ? '選択した答え'
          : null
  );
  const buttonClass = $derived(
    showResult && isCorrectChoice
      ? 'border-emerald-500 bg-emerald-50 text-emerald-900'
      : showResult && isSelected && correctChoiceId === null
        ? 'border-sky-400 bg-sky-50 text-sky-900'
        : showResult && isSelected
          ? 'border-red-400 bg-red-50 text-red-900'
          : 'border-gray-200 bg-white text-gray-900 hover:border-gray-300 hover:bg-gray-50'
  );

  function handleClick(): void {
    if (disabled) {
      return;
    }

    onChoose(choice.choiceId);
  }
</script>

<button
  type="button"
  {disabled}
  onclick={handleClick}
  class={`flex min-h-16 w-full items-center gap-3 rounded border px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-brand)] disabled:cursor-not-allowed ${buttonClass}`}
  aria-label={`${index + 1}番、${choice.text}${resultLabel ? `、${resultLabel}` : ''}`}
>
  <span
    class="flex h-8 w-8 shrink-0 items-center justify-center rounded bg-gray-100 text-sm font-bold text-gray-700"
  >
    {index + 1}
  </span>
  <span class="min-w-0 flex-1 break-words">{choice.text}</span>
  {#if resultLabel}
    <span class="shrink-0 text-xs font-bold">{resultLabel}</span>
  {/if}
</button>
