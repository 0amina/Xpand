/**
 * Client-side image downscaling.
 *
 * A phone camera photo is 3–8 MB, while the whole `localStorage` origin quota is typically
 * ~5 MB. Since pending invoices are held on-device until the invoices API exists, every
 * capture is re-encoded down to something a queue can actually hold — roughly 100–300 KB —
 * while staying legible enough to read an invoice number off.
 */

/** Longest edge, in px, of a stored invoice photo. Comfortably readable for OCR later. */
const MAX_DIMENSION = 1400;
const JPEG_QUALITY = 0.72;

export interface CompressedImage {
  /** A `data:image/jpeg;base64,...` URL, ready to drop straight into an `<img src>`. */
  dataUrl: string;
  /** Approximate decoded size in bytes, for the quota check. */
  bytes: number;
  width: number;
  height: number;
}

/** A data URL's payload is base64: 4 characters encode 3 bytes, minus any `=` padding. */
function approximateBytes(dataUrl: string): number {
  const base64 = dataUrl.slice(dataUrl.indexOf(',') + 1);
  const padding = base64.endsWith('==') ? 2 : base64.endsWith('=') ? 1 : 0;
  return Math.floor((base64.length * 3) / 4) - padding;
}

/**
 * Read a picked `File` and re-encode it as a downscaled JPEG.
 *
 * Uses `createImageBitmap` where available — it decodes off the main thread, so a large photo
 * doesn't freeze the UI mid-entry — and falls back to an `<img>` decode elsewhere.
 */
export async function compressImage(file: File): Promise<CompressedImage> {
  const bitmap = await loadBitmap(file);

  const scale = Math.min(1, MAX_DIMENSION / Math.max(bitmap.width, bitmap.height));
  const width = Math.round(bitmap.width * scale);
  const height = Math.round(bitmap.height * scale);

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Could not process the image on this device.');

  // A white backdrop keeps transparent PNG scans from turning black once flattened to JPEG.
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(bitmap as CanvasImageSource, 0, 0, width, height);

  if ('close' in bitmap && typeof bitmap.close === 'function') bitmap.close();

  const dataUrl = canvas.toDataURL('image/jpeg', JPEG_QUALITY);
  return { dataUrl, bytes: approximateBytes(dataUrl), width, height };
}

async function loadBitmap(file: File): Promise<ImageBitmap | HTMLImageElement> {
  if (typeof createImageBitmap === 'function') {
    try {
      return await createImageBitmap(file);
    } catch {
      // Some webviews reject certain HEIC/AVIF sources here; fall through to the <img> path.
    }
  }

  const url = URL.createObjectURL(file);
  try {
    return await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That file could not be read as an image.'));
      img.src = url;
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}
