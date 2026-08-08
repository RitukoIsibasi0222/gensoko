<script lang="ts">
  import type { TopPageCta } from '$lib/home/content';

  type Props = {
    title: string;
    description: string;
    primaryCta: TopPageCta;
    secondaryCta: TopPageCta;
  };

  let { title, description, primaryCta, secondaryCta }: Props = $props();
</script>

<section class="border-border-muted bg-surface rounded-2xl border p-6 sm:p-8">
  <p class="text-text-subtle text-sm font-semibold tracking-wide">Gensoko</p>
  <h1 class="text-text mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
  <p class="text-text mt-4 w-full text-base leading-relaxed">{description}</p>

  <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
    <div class="flex flex-col gap-1">
      {#if primaryCta.disabled}
        <span
          class="bg-surface-disabled text-text-subtle inline-flex cursor-not-allowed items-center justify-center rounded px-5 py-2.5 text-sm font-semibold"
          aria-disabled="true"
        >
          {primaryCta.label}
        </span>
      {:else}
        <a
          href={primaryCta.href}
          class="bg-action hover:bg-action-hover focus-visible:outline-focus text-text-inverse inline-flex items-center justify-center rounded px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {primaryCta.label}
        </a>
      {/if}
      <p class="text-text-subtle text-xs">{primaryCta.description}</p>
    </div>

    <div class="flex flex-col gap-1">
      <a
        href={secondaryCta.href}
        class="hover:border-brand hover:text-brand focus-visible:outline-focus border-border text-text inline-flex items-center justify-center rounded border px-5 py-2.5 text-sm font-semibold transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {secondaryCta.label}
      </a>
      <p class="text-text-subtle text-xs">{secondaryCta.description}</p>
    </div>
  </div>
</section>
