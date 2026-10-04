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

/**
 * Longest edge of a *scanned* image. Much larger than `MAX_DIMENSION` above: this path feeds
 * OCR rather than a `localStorage` queue, and Tesseract's accuracy falls off sharply once the
 * characters on an invoice drop below roughly 20px tall.
 */
const SCAN_MAX_DIMENSION = 2600;
const SCAN_JPEG_QUALITY = 0.92;

/**
 * Re-encode an image file as a JPEG the invoices API will accept.
 *
 * Two cases need it, and both come from the camera rather than from anything the app controls:
 * an iOS photo that arrives as HEIC, which the backend cannot read at all, and a 12 MP frame
 * that is over the upload ceiling. Rejecting either with a toast was the old behaviour and left
 * the user with nothing to do about it.
 *
 * Resolves to `null` when the file cannot be decoded here, so the caller can still fall back to
 * uploading the original and letting the server have the final say.
 */
export async function transcodeToJpeg(file: File): Promise<File | null> {
  let bitmap: ImageBitmap | HTMLImageElement;
  try {
    bitmap = await loadBitmap(file);
  } catch {
    return null;
  }

  const source = bitmap as unknown as { width: number; height: number };
  const scale = Math.min(1, SCAN_MAX_DIMENSION / Math.max(source.width, source.height));
  const width = Math.round(source.width * scale);
  const height = Math.round(source.height * scale);

  const blob = await drawToJpeg(bitmap, width, height, SCAN_JPEG_QUALITY);
  if (!blob) return null;

  const base = file.name.replace(/\.[^.]+$/, '') || 'invoice';
  return new File([blob], `${base}.jpg`, { type: 'image/jpeg' });
}

/**
 * Whether this runtime can open a camera stream at all.
 *
 * `navigator.mediaDevices` is absent outside a secure context (plain `http://`, which is how the
 * app runs on a LAN address during development) and in jsdom. Checked before the scanner's camera
 * button is wired up, so the file-picker path stays the one offered when a live preview is
 * impossible rather than being reached through an error.
 */
export function cameraStreamSupported(): boolean {
  return (
    typeof navigator !== 'undefined' && typeof navigator.mediaDevices?.getUserMedia === 'function'
  );
}

/**
 * Capture one frame of a live camera stream as a JPEG file.
 *
 * Used by the in-app scanner, which draws the `<video>` element the stream is playing into
 * rather than going through a file picker — see `CameraSheet`.
 */
export async function frameToJpegFile(
  video: HTMLVideoElement,
  filename = 'invoice.jpg',
): Promise<File> {
  const scale = Math.min(
    1,
    SCAN_MAX_DIMENSION / Math.max(video.videoWidth, video.videoHeight || 1),
  );
  const width = Math.round(video.videoWidth * scale);
  const height = Math.round(video.videoHeight * scale);

  const blob = await drawToJpeg(video, width, height, SCAN_JPEG_QUALITY);
  if (!blob) throw new Error('The photo could not be saved on this device.');

  return new File([blob], filename, { type: 'image/jpeg' });
}

/** Shared canvas path for the two functions above. Flattens onto white, as `compressImage` does. */
async function drawToJpeg(
  source: CanvasImageSource,
  width: number,
  height: number,
  quality: number,
): Promise<Blob | null> {
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const ctx = canvas.getContext('2d');
  if (!ctx) return null;

  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, width, height);
  ctx.drawImage(source, 0, 0, width, height);

  if (typeof source === 'object' && 'close' in source && typeof source.close === 'function') {
    source.close();
  }

  // `toBlob` is absent in a few older webviews; fall back through the data URL.
  if (typeof canvas.toBlob !== 'function') {
    const dataUrl = canvas.toDataURL('image/jpeg', quality);
    const response = await fetch(dataUrl);
    return response.blob();
  }

  return new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
}
