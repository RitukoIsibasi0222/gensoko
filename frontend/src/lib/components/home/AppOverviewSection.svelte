<script lang="ts">
  type OverviewItem = {
    title: string;
    description: string;
  };

  type Props = {
    description: string;
    items: readonly OverviewItem[];
  };

  let { description, items }: Props = $props();
</script>

<section class="border-border-muted bg-surface rounded-2xl border p-6 sm:p-8">
  <h2 class="text-text text-2xl font-bold">アプリ概要</h2>
  <p class="text-text-muted mt-2 text-sm">{description}</p>

  <ul class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="トップページ概要一覧">
    {#each items as item (item.title)}
      <li class="border-border-muted bg-surface-muted rounded-xl border p-4">
        <h3 class="text-text text-base font-semibold">{item.title}</h3>
        <p class="text-text mt-2 text-sm leading-relaxed">{item.description}</p>
      </li>
    {/each}
  </ul>
</section>
