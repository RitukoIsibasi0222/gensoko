<script lang="ts">
  // SSR/クライアント間でタイムゾーン差による hydration mismatch を防ぐため Asia/Tokyo で統一
  const year = new Intl.DateTimeFormat('ja-JP', { timeZone: 'Asia/Tokyo', year: 'numeric' }).format(
    new Date()
  );
</script>

<footer class="border-t border-gray-200 bg-white">
  <div class="mx-auto max-w-5xl px-4 py-4 text-center text-sm text-gray-600">
    &copy; {year} Gensoko
  </div>
</footer>
