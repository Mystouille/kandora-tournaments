import { toBlob } from "html-to-image";

export function gameSummaryExportScale(width: number, height: number): number {
  if (
    !Number.isFinite(width) ||
    !Number.isFinite(height) ||
    width <= 0 ||
    height <= 0
  ) {
    throw new Error("The summary canvas has invalid dimensions");
  }
  return Math.min(
    1,
    16384 / width,
    16384 / height,
    Math.sqrt(16_000_000 / (width * height))
  );
}

export function gameSummaryFilename(name: string): string {
  const safe = name
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 140);
  return `game-summary-${safe || "export"}.png`;
}

async function renderSummaryImage(canvas: HTMLElement): Promise<Blob> {
  await document.fonts.ready;
  const images = [...canvas.querySelectorAll("img")];
  await Promise.all(images.map((image) => image.decode()));
  const width = canvas.offsetWidth;
  const clone = canvas.cloneNode(true);
  if (!(clone instanceof HTMLElement)) {
    throw new Error("The summary canvas could not be copied");
  }

  // Embed decoded images ourselves: the renderer otherwise silently drops failed fetches.
  const clonedImages = [...clone.querySelectorAll("img")];
  for (let index = 0; index < images.length; index++) {
    const image = images[index];
    const raster = document.createElement("canvas");
    const ratio = Math.min(
      1,
      2048 / Math.max(image.naturalWidth, image.naturalHeight)
    );
    raster.width = Math.max(1, Math.round(image.naturalWidth * ratio));
    raster.height = Math.max(1, Math.round(image.naturalHeight * ratio));
    const context = raster.getContext("2d");
    if (!context) {
      throw new Error("The browser could not prepare an image for export");
    }
    context.drawImage(image, 0, 0, raster.width, raster.height);
    clonedImages[index].src = raster.toDataURL("image/png");
    clonedImages[index].removeAttribute("srcset");
  }
  const container = document.createElement("div");
  container.setAttribute("aria-hidden", "true");
  Object.assign(container.style, {
    position: "fixed",
    left: "-100000px",
    top: "0",
    width: `${width}px`,
    pointerEvents: "none",
  });
  container.appendChild(clone);
  document.body.appendChild(container);
  try {
    await Promise.all(clonedImages.map((image) => image.decode()));
    // Preview zoom rounds table spacing; measure the unscaled layout to keep every row and footer.
    const height = clone.offsetHeight;
    if (clone.scrollHeight > height + 1 || clone.scrollWidth > width + 1) {
      throw new Error("The summary content overflows its export canvas");
    }
    const scale = gameSummaryExportScale(width, height);
    const blob = await toBlob(clone, {
      width,
      height,
      pixelRatio: scale,
      skipAutoScale: true,
      fontEmbedCSS: "",
      backgroundColor: "#08120f",
    });
    if (!blob || blob.size === 0) {
      throw new Error("The browser returned an empty summary image");
    }
    return blob;
  } finally {
    container.remove();
  }
}

export async function downloadGameSummary(
  canvas: HTMLElement,
  name: string
): Promise<void> {
  const blob = await renderSummaryImage(canvas);
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = gameSummaryFilename(name);
  document.body.appendChild(link);
  try {
    link.click();
  } finally {
    link.remove();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
}
