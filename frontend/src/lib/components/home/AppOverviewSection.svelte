<script lang="ts">
  type OverviewItem = {
    title: string;
    description: string;
  };

  type Props = {
    items: readonly OverviewItem[];
  };

  let { items }: Props = $props();
</script>

<section class="rounded-2xl border border-gray-200 bg-white p-6 shadow-sm sm:p-8">
  <h2 class="text-ink text-2xl font-bold">アプリ概要</h2>
  <p class="mt-2 text-sm text-gray-600">学習フローの全体像を3つのポイントで把握できます。</p>

  <ul class="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3" aria-label="トップページ概要一覧">
    {#each items as item (item.title)}
      <li class="rounded-xl border border-gray-200 bg-gray-50 p-4">
        <h3 class="text-ink text-base font-semibold">{item.title}</h3>
        <p class="mt-2 text-sm leading-relaxed text-gray-700">{item.description}</p>
      </li>
    {/each}
  </ul>
</section>
