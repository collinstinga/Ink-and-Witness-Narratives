/**
 * Helper to dynamically set and synchronize the browser tab favicon and site icon
 */
const optimizedIcons = new WeakSet<HTMLLinkElement>();

export function applyFavicon(faviconUrl?: string | null, deliveredMimeType?: 'image/webp') {
  if (typeof document === 'undefined') return;
  
  const targetUrl = faviconUrl && faviconUrl.trim() !== '' 
    ? faviconUrl 
    : '/icon.svg';

  const updateIcon = (link: HTMLLinkElement) => {
    link.href = targetUrl;
    if (deliveredMimeType) {
      link.type = deliveredMimeType;
      optimizedIcons.add(link);
    } else if (optimizedIcons.delete(link)) {
      // A later writer update may point to an untouched JPEG, SVG, external
      // image or inline icon. Do not keep our previous WebP MIME declaration.
      link.removeAttribute('type');
    }
  };

  let links = document.querySelectorAll<HTMLLinkElement>("link[rel*='icon']");
  if (links.length === 0) {
    const newLink = document.createElement('link');
    newLink.rel = 'shortcut icon';
    updateIcon(newLink);
    document.head.appendChild(newLink);
  } else {
    links.forEach(link => {
      updateIcon(link);
    });
  }
}
