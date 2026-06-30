import type { CSSProperties, ReactNode } from "react";

interface PageTitleProps {
  title: ReactNode;
  subtitle?: ReactNode;
  centered?: boolean;
  children?: ReactNode;
  style?: CSSProperties;
}

export function PageTitle({
  title,
  subtitle,
  centered = true,
  children,
  style,
}: PageTitleProps) {
  return (
    <div
      style={{
        textAlign: centered ? "center" : undefined,
        marginBottom: centered ? 32 : undefined,
        ...style,
      }}
    >
      <h1 style={{ fontSize: "2.5rem", marginBottom: 8 }}>{title}</h1>
      {subtitle && (
        <p style={{ fontSize: "1.2rem", color: "#666", margin: 0 }}>
          {subtitle}
        </p>
      )}
      {children}
    </div>
  );
}
