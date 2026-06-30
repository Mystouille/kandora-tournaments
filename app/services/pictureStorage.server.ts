import { createHash } from "node:crypto";
import { mkdir, writeFile, access } from "node:fs/promises";
import path from "node:path";
import sharp from "sharp";
import { uploadDir, basePath } from "../../config";
import type { PicturePair } from "../types/pictures";

// Variant dimensions (px). The cropped thumbnail is rendered small
// (~24-64px) but kept at 256 for retina; the full preview is shown at
// up to ~400px, capped here at 1024 for headroom.
const CROPPED_WIDTH = 256;
const FULL_WIDTH = 1024;
const WEBP_QUALITY = 80;

/** Public URL prefix produced for stored files. */
const STORED_URL_PREFIX = `${basePath}/api/uploads/`;

function hashBuffer(buffer: Buffer): string {
  return createHash("sha256").update(buffer).digest("hex").slice(0, 32);
}

/**
 * Write a buffer to the upload dir under a content-hash `.webp` filename
 * (deduped — identical content is written once) and return its public URL.
 */
export async function writeWebpBuffer(data: Buffer): Promise<string> {
  const filename = `${hashBuffer(data)}.webp`;
  const dir = path.resolve(uploadDir);
  await mkdir(dir, { recursive: true });
  const filePath = path.join(dir, filename);

  let exists = false;
  try {
    await access(filePath);
    exists = true;
  } catch {
    // not present — will write below
  }
  if (!exists) {
    await writeFile(filePath, data);
  }

  return `${STORED_URL_PREFIX}${filename}`;
}

/** True if the value is already a stored `/api/uploads/...` URL. */
function isStoredUrl(value: string): boolean {
  return value.startsWith(STORED_URL_PREFIX);
}

/** Decode a `data:image/...;base64,...` URL into a raw buffer. */
function decodeDataUrl(value: string): Buffer {
  const comma = value.indexOf(",");
  const base64 = comma >= 0 ? value.slice(comma + 1) : value;
  return Buffer.from(base64, "base64");
}

/**
 * Convert a single picture (base64 data-URL or already-stored URL) into a
 * stored WebP variant of the given width and return its public URL.
 * Already-stored URLs are returned unchanged (idempotent).
 */
async function storeVariant(value: string, width: number): Promise<string> {
  if (isStoredUrl(value)) {
    return value;
  }
  const input = decodeDataUrl(value);
  const optimized = await sharp(input)
    .resize({ width, withoutEnlargement: true })
    .webp({ quality: WEBP_QUALITY })
    .toBuffer();
  return writeWebpBuffer(optimized);
}

/**
 * Convert a {@link PicturePair} whose values are base64 data-URLs into a pair
 * whose values are stored `/api/uploads/<hash>.webp` URLs. Values that are
 * already stored URLs are passed through unchanged, so calling this on an
 * already-migrated pair is a no-op.
 */
export async function storePicturePair(
  pair: PicturePair
): Promise<PicturePair> {
  const [croppedPicture, fullPicture] = await Promise.all([
    storeVariant(pair.croppedPicture, CROPPED_WIDTH),
    storeVariant(pair.fullPicture, FULL_WIDTH),
  ]);
  return { croppedPicture, fullPicture };
}
