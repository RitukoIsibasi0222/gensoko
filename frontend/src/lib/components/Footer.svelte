<script lang="ts">
  // SSR/クライアント間でタイムゾーン差による hydration mismatch を防ぐため Asia/Tokyo で統一
  const year = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(
    new Date()
  );
</script>

<footer class="bg-action">
  <div class="text-text-inverse mx-auto max-w-5xl px-4 py-4 text-center text-sm">
    <div>&copy; {year} Gensoko</div>
    <a
      href="/privacy"
      class="text-link text-text-inverse focus:ring-focus mt-2 inline-block rounded-sm focus:ring-2 focus:ring-offset-2 focus:outline-none"
    >
      プライバシーポリシー
    </a>
  </div>
</footer>
