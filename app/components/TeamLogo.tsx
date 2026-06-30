import { Avatar, Tooltip } from "antd";
import type { AvatarProps } from "antd";
import type { CSSProperties, ReactNode } from "react";
import type { PicturePair } from "../types/pictures";

interface TeamLogoProps {
  /**
   * The team's picture pair (cropped + full). When null/undefined, the
   * fallback `icon` is rendered.
   */
  pictures?: PicturePair | null;
  size?: AvatarProps["size"];
  shape?: AvatarProps["shape"];
  icon?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

const PREVIEW_MAX = 200;

export function TeamLogo({
  pictures,
  size,
  shape = "square",
  icon,
  style,
  className,
}: TeamLogoProps) {
  const hasPicture = !!pictures;
  const avatar = (
    <Avatar
      src={pictures?.croppedPicture}
      icon={!hasPicture ? icon : undefined}
      size={size}
      shape={shape}
      className={className}
      style={{
        ...(hasPicture ? { backgroundColor: "#fff" } : {}),
        ...style,
      }}
    />
  );

  if (!hasPicture) {
    return avatar;
  }

  return (
    <Tooltip
      color="#fff"
      overlayInnerStyle={{ padding: 4 }}
      title={
        <img
          src={pictures.fullPicture}
          alt=""
          style={{
            maxWidth: PREVIEW_MAX,
            maxHeight: PREVIEW_MAX,
            width: "auto",
            height: "auto",
            display: "block",
            backgroundColor: "#fff",
          }}
        />
      }
    >
      {avatar}
    </Tooltip>
  );
}
