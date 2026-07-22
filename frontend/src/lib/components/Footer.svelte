<script lang="ts">
  // SSR/クライアント間でタイムゾーン差による hydration mismatch を防ぐため Asia/Tokyo で統一
  const year = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(
    new Date()
  );
</script>

<footer class="border-border-muted bg-surface border-t">
  <div class="text-text-muted mx-auto max-w-5xl px-4 py-4 text-center text-sm">
    <div>&copy; {year} Gensoko</div>
    <a
      href="/privacy"
      class="text-action-text focus:ring-focus mt-2 inline-block rounded-sm hover:underline focus:ring-2 focus:ring-offset-2 focus:outline-none"
    >
      プライバシーポリシー
    </a>
  </div>
</footer>
