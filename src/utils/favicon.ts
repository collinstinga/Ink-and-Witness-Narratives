/**
 * Helper to dynamically set and synchronize the browser tab favicon and site icon
 */
export function applyFavicon(faviconUrl?: string | null) {
  if (typeof document === 'undefined') return;
  
  const targetUrl = faviconUrl && faviconUrl.trim() !== '' 
    ? faviconUrl 
    : '/icon.svg';

  let links = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
  if (links.length === 0) {
    const newLink = document.createElement('link');
    newLink.rel = 'shortcut icon';
    newLink.href = targetUrl;
    document.head.appendChild(newLink);
  } else {
    links.forEach(link => {
      link.href = targetUrl;
    });
  }
}
