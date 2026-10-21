const CLOUD_NAME = process.env.CLOUDINARY_CLOUD_NAME ?? '';

/**
 * Converts a Cloudinary public_id (storage key) to a full URL.
 * Handles backward compatibility: if the value is already a full URL (old data), returns it as-is.
 * When migrating to a different provider (e.g. Cloudflare R2), only this function needs to change.
 */
export function getImageUrl(keyOrUrl: string | null | undefined): string | null {
  if (!keyOrUrl) return null;
  if (keyOrUrl.startsWith('http')) return keyOrUrl;
  return `https://res.cloudinary.com/${CLOUD_NAME}/image/upload/${keyOrUrl}`;
}
