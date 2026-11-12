export function pageHead(title: string, description: string, canonicalPath?: string) {
  return {
    meta: [
      { title: `${title} | ترابار TERRABAR` },
      { name: 'description', content: description },
      { property: 'og:title', content: `${title} | ترابار TERRABAR` },
      { property: 'og:description', content: description },
      { property: 'og:type', content: 'website' },
      { name: 'twitter:card', content: 'summary_large_image' },
    ],
    ...(canonicalPath ? { links: [{ rel: 'canonical', href: `https://terrabar.ir${canonicalPath}` }] } : {}),
  };
}
