<script lang="ts">
  import Header from '$lib/components/Header.svelte';
  import Footer from '$lib/components/Footer.svelte';

  let { children } = $props();
</script>

<div class="flex min-h-screen flex-col">
  <Header />
  <main class="mx-auto w-full max-w-5xl flex-1 px-4 py-8">
    {@render children()}
  </main>
  <Footer />
</div>
