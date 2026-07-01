import React from "react";
import { theme } from "antd";
import { MenuFoldOutlined, MenuUnfoldOutlined } from "@ant-design/icons";
import { useAppTheme } from "../contexts/ThemeContext";
import { LogoDisplay } from "./LogoDisplay";
import { LoginDropdown } from "./LoginDropdown";
import { ThemeToggle } from "./ThemeToggle";
import { LanguageSwitcher } from "./LanguageSwitcher";
import { useFormFactor } from "../contexts/FormFactorContext";

interface HeaderProps {
  collapsed: boolean;
  onToggleCollapse: () => void;
  onLogin: () => void;
  onLogout: () => void;
  currentUser: any;
  authLoading?: boolean;
  /** Whether to show the sidebar collapse toggle (hidden when there is no sidebar). */
  showSidebarToggle?: boolean;
}

export function Header({
  collapsed,
  onToggleCollapse,
  onLogin,
  onLogout,
  currentUser,
  authLoading,
  showSidebarToggle = true,
}: HeaderProps) {
  const { customTokens } = useAppTheme();
  const { isMobile } = useFormFactor();
  const {
    token: { borderRadiusLG, colorBgLayout },
  } = theme.useToken();
  const { headerHeight, buttonTextColor, headerLogoMaxWidth, siderBg } =
    customTokens;

  return (
    <div
      style={{
        padding: isMobile ? "8px 12px" : "0 12px",
        background: siderBg,
        display: "flex",
        flexDirection: "column",
        justifyContent: "center",
        minHeight: headerHeight,
        height: isMobile ? "auto" : headerHeight,
        gap: "8px",
        position: "relative",
      }}
    >
      {!isMobile && (
        <>
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              bottom: -borderRadiusLG,
              width: borderRadiusLG,
              height: borderRadiusLG,
              background: siderBg,
              borderTopRightRadius: borderRadiusLG,
              transform: "rotate(90deg)",
              pointerEvents: "none",
            }}
          />
          <div
            aria-hidden
            style={{
              position: "absolute",
              left: 0,
              bottom: -borderRadiusLG,
              width: borderRadiusLG,
              height: borderRadiusLG,
              background: colorBgLayout,
              borderBottomLeftRadius: borderRadiusLG,
              transform: "rotate(90deg)",
              pointerEvents: "none",
            }}
          />
        </>
      )}

      {isMobile ? (
        <div
          style={{
            width: "100%",
            display: "grid",
            gridTemplateColumns: "24px minmax(120px, 1fr) auto",
            gridTemplateRows: "auto auto",
            columnGap: "8px",
            rowGap: "8px",
            alignItems: "center",
            paddingBottom: "4px",
          }}
        >
          {showSidebarToggle ? (
            React.createElement(
              collapsed ? MenuUnfoldOutlined : MenuFoldOutlined,
              {
                className: "trigger",
                onClick: onToggleCollapse,
                style: {
                  gridColumn: "1",
                  gridRow: "1 / span 2",
                  fontSize: "18px",
                  cursor: "pointer",
                  color: buttonTextColor,
                  flexShrink: 0,
                },
              }
            )
          ) : (
            <div style={{ gridColumn: "1", gridRow: "1 / span 2" }} />
          )}

          <div
            style={{
              gridColumn: "2",
              gridRow: "1 / span 2",
              width: "100%",
              minHeight: "64px",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <div
              style={{
                width: "min(44vw, 220px)",
                height: "100%",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <LogoDisplay size="large" />
            </div>
          </div>

          <div
            style={{
              gridColumn: "3",
              gridRow: "1",
              display: "flex",
              gap: "8px",
              alignItems: "center",
              justifySelf: "end",
            }}
          >
            <LanguageSwitcher />
            <ThemeToggle />
          </div>

          <div
            style={{
              gridColumn: "3",
              gridRow: "2",
              justifySelf: "end",
            }}
          >
            <LoginDropdown
              onLogin={onLogin}
              onLogout={onLogout}
              currentUser={currentUser}
              authLoading={authLoading}
            />
          </div>
        </div>
      ) : (
        <div
          style={{
            width: "100%",
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            minHeight: headerHeight,
          }}
        >
          {showSidebarToggle ? (
            React.createElement(
              collapsed ? MenuUnfoldOutlined : MenuFoldOutlined,
              {
                className: "trigger",
                onClick: onToggleCollapse,
                style: {
                  fontSize: "18px",
                  cursor: "pointer",
                  color: buttonTextColor,
                  flexShrink: 0,
                },
              }
            )
          ) : (
            <span style={{ width: 18, flexShrink: 0 }} />
          )}

          <div
            style={{
              width: headerLogoMaxWidth,
              height: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <LogoDisplay size="large" />
          </div>

          <div
            style={{
              display: "flex",
              gap: "8px",
              alignItems: "center",
              flexShrink: 0,
            }}
          >
            <LoginDropdown
              onLogin={onLogin}
              onLogout={onLogout}
              currentUser={currentUser}
              authLoading={authLoading}
            />
            <LanguageSwitcher />
            <ThemeToggle />
          </div>
        </div>
      )}
    </div>
  );
}
