import { readFile, access } from "node:fs/promises";
import path from "node:path";
import { uploadDir } from "../../../config";

const SAFE_FILENAME = /^[a-zA-Z0-9_-]+\.(webp|mp4|webm|ogv|mov)$/;

const CONTENT_TYPES: Record<string, string> = {
  webp: "image/webp",
  mp4: "video/mp4",
  webm: "video/webm",
  ogv: "video/ogg",
  mov: "video/quicktime",
};

/** GET /api/uploads/:filename — serve an uploaded image or video */
export async function loader({
  params,
}: {
  params: { filename: string };
  request: Request;
}) {
  const { filename } = params;

  // Reject path traversal and malformed filenames
  if (!filename || !SAFE_FILENAME.test(filename)) {
    return new Response("Bad request", { status: 400 });
  }

  const ext = filename.split(".").pop() ?? "";
  const contentType = CONTENT_TYPES[ext] ?? "application/octet-stream";
  const isImage = contentType.startsWith("image/");

  const filePath = path.join(path.resolve(uploadDir), filename);

  try {
    await access(filePath);
  } catch {
    // In dev, return a placeholder so articles with prod image URLs still render
    if (isImage && process.env.NODE_ENV !== "production") {
      return placeholderResponse();
    }
    return new Response("Not found", { status: 404 });
  }

  const data = await readFile(filePath);
  return new Response(data, {
    headers: {
      "Content-Type": contentType,
      "Cache-Control": "public, max-age=31536000, immutable",
    },
  });
}

function placeholderResponse(): Response {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="400" height="300" viewBox="0 0 400 300">
  <rect width="400" height="300" fill="#f0f0f0"/>
  <text x="200" y="150" text-anchor="middle" dominant-baseline="middle"
        font-family="sans-serif" font-size="16" fill="#999">
    Image not available
  </text>
</svg>`;
  return new Response(svg, {
    headers: {
      "Content-Type": "image/svg+xml",
      "Cache-Control": "no-cache",
    },
  });
}
