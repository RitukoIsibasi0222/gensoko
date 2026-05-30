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

<section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
  <p class="text-sm font-semibold tracking-wide text-gray-500">Gensoko</p>
  <h1 class="text-ink mt-2 text-3xl font-bold sm:text-4xl">{title}</h1>
  <p class="mt-4 max-w-2xl text-base leading-relaxed text-gray-700">{description}</p>

  <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
    <div class="flex flex-col gap-1">
      {#if primaryCta.disabled}
        <span
          class="inline-flex cursor-not-allowed items-center justify-center rounded-lg bg-gray-200 px-5 py-2.5 text-sm font-semibold text-gray-500"
          aria-disabled="true"
        >
          {primaryCta.label}
        </span>
      {:else}
        <a
          href={primaryCta.href}
          class="bg-brand hover:bg-brand-hover focus-visible:outline-brand inline-flex items-center justify-center rounded-lg px-5 py-2.5 text-sm font-semibold text-white transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
        >
          {primaryCta.label}
        </a>
      {/if}
      <p class="text-xs text-gray-500">{primaryCta.description}</p>
    </div>

    <div class="flex flex-col gap-1">
      <a
        href={secondaryCta.href}
        class="hover:border-brand hover:text-brand focus-visible:outline-brand inline-flex items-center justify-center rounded-lg border border-gray-300 px-5 py-2.5 text-sm font-semibold text-gray-700 transition-colors focus-visible:outline-2 focus-visible:outline-offset-2"
      >
        {secondaryCta.label}
      </a>
      <p class="text-xs text-gray-500">{secondaryCta.description}</p>
    </div>
  </div>
</section>
