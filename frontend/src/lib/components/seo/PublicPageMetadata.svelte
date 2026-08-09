<script lang="ts">
  import { page } from '$app/state';

  type OpenGraphType = 'website' | 'article';

  type Props = {
    title: string;
    description: string;
    type?: OpenGraphType;
    imageAlt?: string;
  };

  let {
    title,
    description,
    type = 'website',
    imageAlt = 'Gensoko 元素を遊んで覚える'
  }: Props = $props();

  const canonicalUrl = $derived(new URL(page.url.pathname, page.url.origin).href);
  const imageUrl = $derived(new URL('/images/gensoko-ogp.png', page.url.origin).href);
</script>

<svelte:head>
  <title>{title}</title>
  <meta name="description" content={description} />
  <link rel="canonical" href={canonicalUrl} />

  <meta property="og:title" content={title} />
  <meta property="og:description" content={description} />
  <meta property="og:type" content={type} />
  <meta property="og:url" content={canonicalUrl} />
  <meta property="og:image" content={imageUrl} />
  <meta property="og:image:width" content="1200" />
  <meta property="og:image:height" content="630" />
  <meta property="og:image:type" content="image/png" />
  <meta property="og:image:alt" content={imageAlt} />
  <meta property="og:site_name" content="Gensoko" />
  <meta property="og:locale" content="ja_JP" />

  <meta name="twitter:card" content="summary_large_image" />
  <meta name="twitter:title" content={title} />
  <meta name="twitter:description" content={description} />
  <meta name="twitter:image" content={imageUrl} />
  <meta name="twitter:image:alt" content={imageAlt} />
</svelte:head>
