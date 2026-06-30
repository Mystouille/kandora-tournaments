import React from "react";
import { Layout, Menu, Drawer } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  FlagOutlined,
  HomeOutlined,
  CalendarOutlined,
  GlobalOutlined,
  BarChartOutlined,
  EditOutlined,
  EyeOutlined,
  ReadOutlined,
  FileTextOutlined,
  FileSearchOutlined,
  BookOutlined,
  TrophyOutlined,
  QuestionCircleOutlined,
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
  children?: MenuItem[]
): MenuItem {
  return {
    key,
    icon,
    children,
    label,
  } as MenuItem;
}

interface SidebarProps {
  collapsed: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  currentUser?: any;
}

export function Sidebar({
  collapsed,
  isMobile,
  onClose,
  currentUser,
}: SidebarProps) {
  const location = useLocation();
  const { isDark, customTokens } = useAppTheme();
  const { t } = useLocale();
  const { siderBg, logoPathMobileLight, logoPathMobileDark } = customTokens;

  const resolveSelectedKey = (pathname: string, keys: string[]) => {
    if (pathname === "/") {
      return "/";
    }
    return keys.find(
      (key) => pathname === key || pathname.startsWith(`${key}/`)
    );
  };

  const items: MenuItem[] = [
    getItem(<Link to="/">{t.nav.home}</Link>, "/", <HomeOutlined />),
    getItem(
      <Link to="/online-tournaments">{t.nav.onlineTournaments}</Link>,
      "/online-tournaments",
      <BarChartOutlined />
    ),
  ];

  const selectedKey =
    resolveSelectedKey(location.pathname, [
      "/posts",
      "/club-sessions",
      "/online-events",
      "/online-tournaments",
      "/links",
      "/resources/glossary",
      "/resources/wait-types",
      "/exercices",
      "/review",
      "/tournaments",
      "/palmares",
      "/admin/articles",
      "/admin/tournaments",
    ]) || location.pathname;

  // Determine which submenu groups should be open based on current path
  const openKeys: string[] = [];
  if (
    ["/posts", "/exercices", "/review", "/resources", "/links"].some((p) =>
      location.pathname.startsWith(p)
    )
  ) {
    openKeys.push("learn-group");
  }
  if (
    location.pathname.startsWith("/resources") ||
    location.pathname.startsWith("/links")
  ) {
    openKeys.push("resources-group");
  }
  if (
    ["/club-sessions", "/tournaments"].some((p) =>
      location.pathname.startsWith(p)
    )
  ) {
    openKeys.push("in-person-group");
  }

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
      {" "}
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
        defaultOpenKeys={openKeys}
        items={items}
        onClick={() => isMobile && onClose?.()}
        style={{
          background: siderBg,
          border: "none",
          flex: 1,
        }}
      />
      {(currentUser?.isAdmin || currentUser?.isEditor) && (
        <Menu
          theme={isDark ? "dark" : "light"}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={[
            getItem(
              <Link to="/admin/articles">{t.news.admin.title}</Link>,
              "/admin/articles",
              <FileTextOutlined />
            ),
            // Tournament management stays admin-only; editors only get
            // the article/news/glossary management entry above.
            ...(currentUser?.isAdmin
              ? [
                  getItem(
                    <Link to="/admin/tournaments">
                      {t.tournaments.admin.manageTitle}
                    </Link>,
                    "/admin/tournaments",
                    <AppstoreOutlined />
                  ),
                ]
              : []),
          ]}
          onClick={() => isMobile && onClose?.()}
          style={{
            background: siderBg,
            border: "none",
            borderTop: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(0,0,0,0.06)"}`,
            color: isDark ? "#faad14" : "#d48806",
          }}
          className="admin-sidebar-menu"
        />
      )}
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
