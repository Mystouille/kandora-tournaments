import React from "react";
import { Layout, Menu, Drawer } from "antd";
import type { MenuProps } from "antd";
import {
  BarChartOutlined,
  PlayCircleOutlined,
  SettingOutlined,
  TrophyOutlined,
  InfoCircleOutlined,
  ToolOutlined,
  UnorderedListOutlined,
} from "@ant-design/icons";
import { Link, useLocation } from "react-router";
import { useAppTheme } from "../contexts/ThemeContext";
import { useLocale } from "../contexts/LocaleContext";
import { LogoDisplay } from "./LogoDisplay";

const { Sider } = Layout;

type MenuItem = Required<MenuProps>["items"][number];

function getItem(
  label: React.ReactNode,
  key: React.Key,
  icon?: React.ReactNode,
  style?: React.CSSProperties
): MenuItem {
  return {
    key,
    icon,
    label,
    style,
  } as MenuItem;
}

interface SidebarProps {
  collapsed: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  /** Adds tournament-specific links while the URL is inside a tournament. */
  tournamentSlug?: string | null;
  currentUser?: { canAccessTournamentAdmin?: boolean } | null;
}

export function Sidebar({
  collapsed,
  isMobile,
  onClose,
  tournamentSlug,
  currentUser,
}: SidebarProps) {
  const location = useLocation();
  const { isDark, customTokens } = useAppTheme();
  const { t } = useLocale();
  const { siderBg, logoPathMobileLight, logoPathMobileDark } = customTokens;

  const tournamentChildStyle: React.CSSProperties | undefined =
    collapsed && !isMobile ? undefined : { paddingInlineStart: 40 };
  const items: MenuItem[] = [
    getItem(<Link to="/">{t.nav.tournaments}</Link>, "/", <TrophyOutlined />),
    ...(currentUser
      ? [
          getItem(
            <Link to="/lobby">{t.nav.gameLobby}</Link>,
            "/lobby",
            <PlayCircleOutlined />
          ),
        ]
      : []),
    ...(tournamentSlug
      ? [
          getItem(
            <Link to={`/online-tournaments/${tournamentSlug}/presentation`}>
              {t.onlineTournaments.navInfo}
            </Link>,
            `/online-tournaments/${tournamentSlug}`,
            <InfoCircleOutlined />,
            tournamentChildStyle
          ),
          getItem(
            <Link to={`/online-tournaments/${tournamentSlug}/statistics`}>
              {t.onlineTournaments.navStatistics}
            </Link>,
            `/online-tournaments/${tournamentSlug}/statistics`,
            <BarChartOutlined />,
            tournamentChildStyle
          ),
        ]
      : []),
    {
      key: "analysis-tools",
      label: t.nav.onlineTools,
      icon: <ToolOutlined />,
      children: [
        getItem(<Link to="/review">{t.nav.replayTools}</Link>, "/review"),
        ...(currentUser
          ? [
              getItem(
                <Link to="/my-replays">{t.nav.myReplays}</Link>,
                "/my-replays",
                <UnorderedListOutlined />
              ),
            ]
          : []),
      ],
    } as MenuItem,
  ];

  const selectedKey = tournamentSlug
    ? location.pathname.startsWith(
        `/online-tournaments/${tournamentSlug}/statistics`
      )
      ? `/online-tournaments/${tournamentSlug}/statistics`
      : `/online-tournaments/${tournamentSlug}`
    : location.pathname === "/" || location.pathname === "/online-tournaments"
      ? "/"
      : location.pathname === "/lobby"
        ? "/lobby"
        : location.pathname === "/review"
          ? "/review"
          : location.pathname === "/my-replays"
            ? "/my-replays"
            : "";

  const showCollapsedLogo = Boolean(collapsed && !isMobile);

  const siderContent = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "calc(100vh - 0px)",
      }}
    >
      <div
        className="demo-logo-vertical"
        style={{
          height: "90px",
          marginTop: "6px",
          marginLeft: "6px",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <div
          style={{
            position: "relative",
            width: "100%",
            height: "100%",
          }}
        >
          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: showCollapsedLogo ? 0 : 1,
              transform: showCollapsedLogo ? "scale(0.92)" : "scale(1)",
              transition: "opacity 220ms ease, transform 220ms ease",
              pointerEvents: "none",
            }}
          >
            <LogoDisplay size="small" />
          </div>

          <div
            style={{
              position: "absolute",
              inset: 0,
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              opacity: showCollapsedLogo ? 1 : 0,
              transform: showCollapsedLogo ? "scale(1)" : "scale(0.9)",
              transition: "opacity 220ms ease, transform 220ms ease",
              pointerEvents: "none",
            }}
          >
            <img
              src={isDark ? logoPathMobileDark : logoPathMobileLight}
              alt="TNT Logo"
              style={{
                width: "80px",
                height: "80px",
                objectFit: "contain",
              }}
            />
          </div>
        </div>
      </div>
      <Menu
        theme={isDark ? "dark" : "light"}
        mode="inline"
        selectedKeys={[selectedKey]}
        defaultOpenKeys={["analysis-tools"]}
        items={items}
        onClick={() => isMobile && onClose?.()}
        style={{
          background: siderBg,
          border: "none",
          flexShrink: 0,
        }}
      />
      {currentUser?.canAccessTournamentAdmin && (
        <Menu
          theme={isDark ? "dark" : "light"}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            getItem(
              <Link to="/admin">{t.admin.title}</Link>,
              "/admin",
              <SettingOutlined />
            ),
          ]}
          onClick={() => {
            if (isMobile) {
              onClose?.();
            }
          }}
          style={{
            background: siderBg,
            border: "none",
            flexShrink: 0,
          }}
          className="admin-sidebar-menu"
        />
      )}
      <div style={{ flex: 1 }} />
    </div>
  );

  if (isMobile) {
    return (
      <Drawer
        placement="left"
        open={!collapsed}
        onClose={onClose}
        size={220}
        styles={{ body: { padding: 0, background: siderBg } }}
      >
        {siderContent}
      </Drawer>
    );
  }

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      style={{
        background: siderBg,
        overflow: "auto",
      }}
    >
      {siderContent}
    </Sider>
  );
}
