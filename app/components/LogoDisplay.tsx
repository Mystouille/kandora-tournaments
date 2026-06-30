import React from "react";
import { useAppTheme } from "../contexts/ThemeContext";
import { useIsMobile } from "../hooks/useIsMobile";

interface LogoDisplayProps {
  size?: "small" | "large";
}

export function LogoDisplay({ size = "large" }: LogoDisplayProps) {
  const { isDark, customTokens } = useAppTheme();
  const isMobile = useIsMobile();
  const {
    logoPathLight,
    logoPathDark,
    logoPathMobileLight,
    logoPathMobileDark,
    headerLogoHeight,
    headerLogoMaxWidth,
    siderLogoHeight,
    siderLogoMaxWidth,
  } = customTokens;

  const isLarge = size === "large";
  const logoHeight = isLarge ? headerLogoHeight : siderLogoHeight;
  const logoMaxWidth = isLarge ? headerLogoMaxWidth : siderLogoMaxWidth;
  const containerWidth = isLarge ? undefined : "150px";

  const lightSrc = isLarge && isMobile ? logoPathMobileLight : logoPathLight;
  const darkSrc = isLarge && isMobile ? logoPathMobileDark : logoPathDark;

  return (
    <div
      style={{
        position: "relative",
        height: logoHeight,
        width: containerWidth,
        flex: isLarge ? "1 1 auto" : undefined,
        minWidth: 0,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        overflow: "hidden",
      }}
    >
      <img
        src={darkSrc}
        alt="TNT Logo White"
        style={{
          maxHeight: logoHeight,
          maxWidth: logoMaxWidth,
          width: "auto",
          height: "auto",
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: isDark ? 1 : 0,
          transition: "opacity 0.3s ease",
        }}
      />
      <img
        src={lightSrc}
        alt="TNT Logo Black"
        style={{
          maxHeight: logoHeight,
          maxWidth: logoMaxWidth,
          width: "auto",
          height: "auto",
          position: "absolute",
          top: "50%",
          left: "50%",
          transform: "translate(-50%, -50%)",
          opacity: isDark ? 0 : 1,
          transition: "opacity 0.3s ease",
        }}
      />
    </div>
  );
}
