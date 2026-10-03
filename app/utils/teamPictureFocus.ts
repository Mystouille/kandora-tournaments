export const TEAM_WATERMARK_ZOOM = 1.18;

export function teamWatermarkFocusOffset(
  imageWidth: number,
  imageHeight: number,
  viewportWidth: number,
  viewportHeight: number,
  centerY: number
): number {
  if (
    ![imageWidth, imageHeight, viewportWidth, viewportHeight].every(
      (value) => Number.isFinite(value) && value > 0
    ) ||
    !Number.isFinite(centerY) ||
    centerY < 0 ||
    centerY > 1
  ) {
    throw new RangeError("Invalid team picture focus or dimensions");
  }
  const coveredHeight =
    imageHeight *
    Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
  const limit = (coveredHeight - viewportHeight / TEAM_WATERMARK_ZOOM) / 2;
  return Math.max(-limit, Math.min(limit, (0.5 - centerY) * coveredHeight));
}

export function applyTeamWatermarkFocus(
  image: HTMLImageElement,
  centerY: number
): void {
  const offset = teamWatermarkFocusOffset(
    image.naturalWidth,
    image.naturalHeight,
    image.clientWidth,
    image.clientHeight,
    centerY
  );
  // Percent-only object-position does not put a source-image focus line at the crop center.
  image.style.objectPosition = `55% calc(50% ${offset < 0 ? "-" : "+"} ${Math.abs(offset)}px)`;
  image.style.transform = `scale(${TEAM_WATERMARK_ZOOM})`;
  image.style.visibility = "visible";
}
