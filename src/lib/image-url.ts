// 999.md serves listing photos from the Simpals CDN. The GraphQL feed (index
// and detail) stores only the bare filename (e.g. "d870….jpg"); the renderable
// URL is "<base>/<size>/<filename>". Verified live: the CDN serves with no
// hotlink protection, so any origin can embed these directly.
const CDN_BASE = 'https://i.simpalsmedia.com/999.md/BoardImages';
const THUMB_SIZE = '320x240';

// Build a thumbnail URL from a stored image value. Passes through values that
// are already absolute URLs (older rows / tests) and returns null for empties.
export function thumbUrl(filename: string | null | undefined): string | null {
  if (!filename) return null;
  if (/^https?:\/\//i.test(filename)) return filename;
  return `${CDN_BASE}/${THUMB_SIZE}/${filename}`;
}

// The primary (first) thumbnail from a stored imageUrls value, or null.
export function primaryThumb(imageUrls: unknown): string | null {
  if (!Array.isArray(imageUrls) || imageUrls.length === 0) return null;
  const first = imageUrls[0];
  return typeof first === 'string' ? thumbUrl(first) : null;
}
