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
      ? 'border-success-border-strong bg-success-surface text-success-text'
      : showResult && isSelected && correctChoiceId === null
        ? 'border-info-border-strong bg-info-surface text-info-text'
        : showResult && isSelected
          ? 'border-danger-border-strong bg-danger-surface text-danger-text-strong'
          : 'border-border-muted bg-surface text-text hover:border-border hover:bg-surface-muted'
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
  class={`focus-visible:outline-focus flex min-h-16 w-full items-center gap-3 rounded border px-4 py-3 text-left text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2 disabled:cursor-not-allowed ${buttonClass}`}
  aria-label={`${index + 1}番、${choice.text}${resultLabel ? `、${resultLabel}` : ''}`}
>
  <span
    class="bg-surface-subtle text-text flex h-8 w-8 shrink-0 items-center justify-center rounded text-sm font-bold"
  >
    {index + 1}
  </span>
  <span class="min-w-0 flex-1 break-words">{choice.text}</span>
  {#if resultLabel}
    <span class="shrink-0 text-xs font-bold">{resultLabel}</span>
  {/if}
</button>
