/**
 * Client-side helpers for resizing and cropping images before upload.
 * All functions return base64 data URLs. PNG is used for cropped output
 * (preserves transparency for logos); JPEG is used for the "full" image
 * to keep the payload small for photographic content.
 */

/** Load a File or data URL into an HTMLImageElement. */
export function loadImage(source: File | string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    let url: string | null = null;
    if (typeof source === "string") {
      img.src = source;
    } else {
      url = URL.createObjectURL(source);
      img.src = url;
    }
    img.onload = () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
      resolve(img);
    };
    img.onerror = () => {
      if (url) {
        URL.revokeObjectURL(url);
      }
      reject(new Error("Failed to load image"));
    };
  });
}

/** Resize an image to fit within `maxDim` (longest side) and return a PNG data URL. */
export function resizeImageToPngDataUrl(
  img: HTMLImageElement,
  maxDim: number
): string {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/png");
}

/** Resize and encode as JPEG with the given quality. */
export function resizeImageToJpegDataUrl(
  img: HTMLImageElement,
  maxDim: number,
  quality = 0.85
): string {
  let { width, height } = img;
  if (width > maxDim || height > maxDim) {
    const scale = maxDim / Math.max(width, height);
    width = Math.round(width * scale);
    height = Math.round(height * scale);
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  ctx.drawImage(img, 0, 0, width, height);
  return canvas.toDataURL("image/jpeg", quality);
}

export interface SquareCropRect {
  /** X offset in source-image pixels of the top-left of the square crop. */
  sx: number;
  /** Y offset in source-image pixels of the top-left of the square crop. */
  sy: number;
  /** Side length in source-image pixels of the square crop. */
  size: number;
}

/**
 * Render a square crop of the source image to a PNG data URL of size
 * `outputDim` × `outputDim`.
 */
export function cropToSquarePngDataUrl(
  img: HTMLImageElement,
  rect: SquareCropRect,
  outputDim: number
): string {
  const canvas = document.createElement("canvas");
  canvas.width = outputDim;
  canvas.height = outputDim;
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    throw new Error("Canvas not supported");
  }
  ctx.drawImage(
    img,
    rect.sx,
    rect.sy,
    rect.size,
    rect.size,
    0,
    0,
    outputDim,
    outputDim
  );
  return canvas.toDataURL("image/png");
}
