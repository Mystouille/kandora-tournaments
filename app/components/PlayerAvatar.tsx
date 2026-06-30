import { Avatar, Popover } from "antd";
import type { AvatarProps } from "antd";
import type { CSSProperties, ReactNode } from "react";
import { UserOutlined } from "@ant-design/icons";
import type { PicturePair } from "../types/pictures";

interface PlayerAvatarProps {
  src?: string | null;
  leaguePicture?: PicturePair | null;
  size?: AvatarProps["size"];
  icon?: ReactNode;
  style?: CSSProperties;
  className?: string;
}

const PREVIEW_MAX = 400;

/**
 * Player avatar (Discord profile picture). When a `leaguePicture`
 * (per-league custom photo pair) is provided, the cropped variant
 * replaces the Discord avatar and clicking opens a popover showing the
 * full variant. Cursor switches to `help` on hover to hint at the
 * interaction.
 */
export function PlayerAvatar({
  src,
  leaguePicture,
  size,
  icon,
  style,
  className,
}: PlayerAvatarProps) {
  const hasLeaguePicture = !!leaguePicture;

  // Prefer the cropped league picture in the round avatar when one is set;
  // fall back to the Discord avatar otherwise.
  const avatarSrc = hasLeaguePicture ? leaguePicture.croppedPicture : src;
  const showFallbackIcon = !avatarSrc;

  const avatar = (
    <Avatar
      src={avatarSrc ?? undefined}
      icon={showFallbackIcon ? (icon ?? <UserOutlined />) : undefined}
      size={size}
      className={className}
      style={{
        ...(hasLeaguePicture ? { cursor: "help" } : {}),
        ...style,
      }}
    />
  );

  if (!hasLeaguePicture) {
    return avatar;
  }

  return (
    <Popover
      trigger="click"
      placement="right"
      overlayInnerStyle={{ padding: 4 }}
      content={
        <div
          style={{
            width: PREVIEW_MAX,
            height: PREVIEW_MAX,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          <img
            src={leaguePicture.fullPicture}
            alt=""
            style={{
              width: "100%",
              height: "100%",
              objectFit: "contain",
              display: "block",
              borderRadius: 4,
            }}
          />
        </div>
      }
    >
      {avatar}
    </Popover>
  );
}
