import { useEffect, useMemo, useRef, useState } from "react";
import { Modal, Slider, Typography } from "antd";
import {
  cropToSquarePngDataUrl,
  loadImage,
  resizeImageToJpegDataUrl,
  type SquareCropRect,
} from "../utils/imageProcessing";
import type { PicturePair } from "../types/pictures";

const { Text } = Typography;

interface SquareImageCropperProps {
  /** Source File or data URL to crop. Reset every time it changes. */
  source: File | string | null;
  /** Whether the modal is open. */
  open: boolean;
  /** Side length (px) of the cropped output PNG. */
  croppedSize: number;
  /** Max dimension of the stored full image (JPEG). */
  fullMaxDim: number;
  /** Title displayed in the modal header. */
  title?: string;
  /** Confirm button label. */
  okText?: string;
  /** Cancel button label. */
  cancelText?: string;
  /** Drag-instructions hint shown below the viewport. */
  helpText?: string;
  /** Called with the resulting picture pair on confirm. */
  onConfirm: (pictures: PicturePair) => void;
  /** Called when the user closes/cancels the modal. */
  onCancel: () => void;
}

const VIEWPORT_PX = 360;

/**
 * Square image cropper modal. The user pans (drag) and zooms (slider /
 * mouse wheel) the source image inside a square viewport. On confirm we
 * emit:
 *  - `croppedPicture`: the square viewport rendered to PNG at `croppedSize`
 *  - `fullPicture`: the full source image resized to `fullMaxDim` (JPEG)
 */
export function SquareImageCropper({
  source,
  open,
  croppedSize,
  fullMaxDim,
  title,
  okText,
  cancelText,
  helpText,
  onConfirm,
  onCancel,
}: SquareImageCropperProps) {
  const [img, setImg] = useState<HTMLImageElement | null>(null);
  const [displaySrc, setDisplaySrc] = useState<string | null>(null);
  const [zoom, setZoom] = useState(1);
  const [offset, setOffset] = useState({ x: 0, y: 0 });
  const [error, setError] = useState<string | null>(null);
  const dragRef = useRef<{ startX: number; startY: number } | null>(null);

  // Load the image whenever the source changes. We keep a separate
  // object URL alive for as long as the cropper renders the <img> tag,
  // since the HTMLImageElement returned by `loadImage` releases its
  // object URL once decoded.
  useEffect(() => {
    let cancelled = false;
    if (!source) {
      setImg(null);
      setDisplaySrc(null);
      return;
    }
    setError(null);

    let createdUrl: string | null = null;
    const srcForJsx =
      typeof source === "string"
        ? source
        : (createdUrl = URL.createObjectURL(source));
    setDisplaySrc(srcForJsx);

    loadImage(source)
      .then((image) => {
        if (cancelled) {
          return;
        }
        setImg(image);
      })
      .catch(() => {
        if (cancelled) {
          return;
        }
        setError("Failed to load image");
      });
    return () => {
      cancelled = true;
      if (createdUrl) {
        URL.revokeObjectURL(createdUrl);
      }
    };
  }, [source]);

  // Reset zoom + pan to a centered "cover" fit each time a new image loads.
  useEffect(() => {
    if (!img) {
      return;
    }
    setZoom(1);
    setOffset({ x: 0, y: 0 });
  }, [img]);

  /**
   * Compute the rendered size of the image inside the viewport at zoom=1
   * (the "cover" fit: shorter side === viewport side).
   */
  const baseSize = useMemo(() => {
    if (!img) {
      return { w: VIEWPORT_PX, h: VIEWPORT_PX };
    }
    const minSide = Math.min(img.naturalWidth, img.naturalHeight);
    const scale = VIEWPORT_PX / minSide;
    return {
      w: img.naturalWidth * scale,
      h: img.naturalHeight * scale,
    };
  }, [img]);

  const renderedSize = {
    w: baseSize.w * zoom,
    h: baseSize.h * zoom,
  };

  /** Clamp pan so the image always covers the viewport. */
  const clampedOffset = useMemo(() => {
    const maxX = Math.max(0, (renderedSize.w - VIEWPORT_PX) / 2);
    const maxY = Math.max(0, (renderedSize.h - VIEWPORT_PX) / 2);
    return {
      x: Math.max(-maxX, Math.min(maxX, offset.x)),
      y: Math.max(-maxY, Math.min(maxY, offset.y)),
    };
  }, [offset, renderedSize.w, renderedSize.h]);

  const onPointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.currentTarget.setPointerCapture(e.pointerId);
    dragRef.current = {
      startX: e.clientX - clampedOffset.x,
      startY: e.clientY - clampedOffset.y,
    };
  };
  const onPointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!dragRef.current) {
      return;
    }
    setOffset({
      x: e.clientX - dragRef.current.startX,
      y: e.clientY - dragRef.current.startY,
    });
  };
  const onPointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.currentTarget.hasPointerCapture(e.pointerId)) {
      e.currentTarget.releasePointerCapture(e.pointerId);
    }
    dragRef.current = null;
  };

  const onWheel = (e: React.WheelEvent<HTMLDivElement>) => {
    if (!img) {
      return;
    }
    e.preventDefault();
    const delta = -e.deltaY * 0.002;
    setZoom((z) => Math.min(4, Math.max(1, z + delta)));
  };

  const handleConfirm = () => {
    if (!img) {
      return;
    }
    // Translate viewport state to a square crop rect in source-image pixels.
    // The image at zoom=1 has size baseSize; at zoom z it has renderedSize.
    // Centered on the viewport, then offset by clampedOffset.
    // Top-left of rendered image (in viewport coords) =
    //   (VIEWPORT/2 - renderedSize.w/2 + offset.x, ...)
    // The viewport's top-left (0,0) corresponds, in rendered image space, to:
    //   (renderedSize.w/2 - offset.x - VIEWPORT/2, ...)
    // Convert that back to source-image pixels by dividing by the total scale.
    const totalScale = renderedSize.w / img.naturalWidth; // === renderedSize.h / naturalHeight
    const sx =
      (renderedSize.w / 2 - clampedOffset.x - VIEWPORT_PX / 2) / totalScale;
    const sy =
      (renderedSize.h / 2 - clampedOffset.y - VIEWPORT_PX / 2) / totalScale;
    const size = VIEWPORT_PX / totalScale;
    const rect: SquareCropRect = { sx, sy, size };

    const croppedPicture = cropToSquarePngDataUrl(img, rect, croppedSize);
    const fullPicture = resizeImageToJpegDataUrl(img, fullMaxDim, 0.85);
    onConfirm({ fullPicture, croppedPicture });
  };

  return (
    <Modal
      open={open}
      title={title}
      okText={okText}
      cancelText={cancelText}
      onOk={handleConfirm}
      onCancel={onCancel}
      okButtonProps={{ disabled: !img }}
      width={VIEWPORT_PX + 64}
      destroyOnClose
    >
      {error && (
        <Text type="danger" style={{ display: "block", marginBottom: 8 }}>
          {error}
        </Text>
      )}
      <div
        style={{
          width: VIEWPORT_PX,
          height: VIEWPORT_PX,
          margin: "0 auto",
          overflow: "hidden",
          position: "relative",
          background: "#f0f0f0",
          borderRadius: "50%",
          touchAction: "none",
          cursor: img ? "grab" : "default",
          userSelect: "none",
        }}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onWheel={onWheel}
      >
        {img && displaySrc && (
          <img
            src={displaySrc}
            alt=""
            draggable={false}
            style={{
              position: "absolute",
              left: "50%",
              top: "50%",
              width: renderedSize.w,
              height: renderedSize.h,
              transform: `translate(calc(-50% + ${clampedOffset.x}px), calc(-50% + ${clampedOffset.y}px))`,
              maxWidth: "none",
              pointerEvents: "none",
            }}
          />
        )}
      </div>
      <div style={{ marginTop: 16 }}>
        <Slider
          min={1}
          max={4}
          step={0.01}
          value={zoom}
          onChange={(v) => setZoom(v as number)}
          disabled={!img}
        />
      </div>
      {helpText && (
        <Text
          type="secondary"
          style={{ display: "block", textAlign: "center", fontSize: 12 }}
        >
          {helpText}
        </Text>
      )}
    </Modal>
  );
}
