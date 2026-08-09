<script lang="ts">
  type Props = {
    title: string;
  };

  let { title }: Props = $props();
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="robots" content="noindex, nofollow" />
</svelte:head>
