<script lang="ts">
  import { onMount } from 'svelte';
  import '../app.css';
  import favicon from '$lib/assets/favicon.svg';
  import { authStore } from '$lib/stores/auth.svelte';

  let { children } = $props();

  // ブラウザ起動時にセッションを復元する。
  // onMount はブラウザ側でのみ実行されるため、sessionStorage に安全にアクセスできる。
  onMount(() => {
    authStore.initialize();
  });
</script>

<svelte:head>
  <link rel="icon" href={favicon} />
</svelte:head>

{@render children()}
