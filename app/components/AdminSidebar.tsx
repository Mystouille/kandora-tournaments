import React from "react";
import { Drawer, Layout, Menu } from "antd";
import type { MenuProps } from "antd";
import {
  AppstoreOutlined,
  ArrowLeftOutlined,
  DashboardOutlined,
  EditOutlined,
  EyeOutlined,
  ImportOutlined,
  PictureOutlined,
  TeamOutlined,
  TrophyOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { Link, useLocation } from "react-router";
import { useAppTheme } from "../contexts/ThemeContext";
import { useLocale } from "../contexts/LocaleContext";
import type { TournamentAdminAccess } from "../utils/league-permissions.server";
import { LogoDisplay } from "./LogoDisplay";

const { Sider } = Layout;

type MenuItem = Required<MenuProps>["items"][number];

function getItem(
  label: React.ReactNode,
  key: React.Key,
  icon?: React.ReactNode
): MenuItem {
  return { key, icon, label } as MenuItem;
}

interface AdminSidebarProps {
  collapsed: boolean;
  isMobile?: boolean;
  onClose?: () => void;
  access?: TournamentAdminAccess | null;
}

export function AdminSidebar({
  collapsed,
  isMobile,
  onClose,
  access,
}: AdminSidebarProps) {
  const location = useLocation();
  const { isDark, customTokens } = useAppTheme();
  const { t } = useLocale();
  const { siderBg, logoPathMobileLight, logoPathMobileDark } = customTokens;
  const tournamentId = location.pathname.match(
    /^\/admin\/online-tournaments\/([^/]+)/
  )?.[1];
  const tournament = access?.tournaments.find(
    (item) => item.id === tournamentId
  );
  const routeBase = tournament
    ? `/admin/online-tournaments/${tournament.id}`
    : null;
  const tournamentPaths = routeBase
    ? [
        `${routeBase}/edit-presentation`,
        `${routeBase}/import-teams`,
        `${routeBase}/edit-finals-roster`,
        `${routeBase}/edit-roster`,
        `${routeBase}/edit-team-pictures`,
        `${routeBase}/edit-player-pictures`,
        routeBase,
      ]
    : [];
  const selectedKey =
    tournamentPaths.find(
      (path) =>
        location.pathname === path || location.pathname.startsWith(`${path}/`)
    ) ?? "/admin";

  const items: MenuItem[] = [
    getItem(
      <Link to="/admin">{t.admin.overview}</Link>,
      "/admin",
      <DashboardOutlined />
    ),
    ...(routeBase && tournament
      ? [
          {
            type: "group" as const,
            label: t.admin.tournament,
            children: [
              getItem(
                <Link to={routeBase}>{t.admin.manageTournament}</Link>,
                routeBase,
                <AppstoreOutlined />
              ),
              getItem(
                <Link to={`${routeBase}/edit-presentation`}>
                  {t.onlineTournaments.admin.editPresentation}
                </Link>,
                `${routeBase}/edit-presentation`,
                <EditOutlined />
              ),
            ],
          },
          {
            type: "group" as const,
            label: t.admin.participants,
            children: [
              getItem(
                <Link to={`${routeBase}/import-teams`}>
                  {t.onlineTournaments.admin.importRoster}
                </Link>,
                `${routeBase}/import-teams`,
                <ImportOutlined />
              ),
              getItem(
                <Link to={`${routeBase}/edit-roster`}>
                  {t.onlineTournaments.admin.editRoster}
                </Link>,
                `${routeBase}/edit-roster`,
                <TeamOutlined />
              ),
              ...(tournament.isTeamMode
                ? [
                    getItem(
                      <Link to={`${routeBase}/edit-team-pictures`}>
                        {t.onlineTournaments.admin.editTeamPictures}
                      </Link>,
                      `${routeBase}/edit-team-pictures`,
                      <PictureOutlined />
                    ),
                  ]
                : []),
              getItem(
                <Link to={`${routeBase}/edit-player-pictures`}>
                  {t.onlineTournaments.admin.editPlayerPictures}
                </Link>,
                `${routeBase}/edit-player-pictures`,
                <UserOutlined />
              ),
              ...(tournament.isTeamMode
                ? [
                    getItem(
                      <Link to={`${routeBase}/edit-finals-roster`}>
                        {t.onlineTournaments.admin.editFinalsRoster}
                      </Link>,
                      `${routeBase}/edit-finals-roster`,
                      <TrophyOutlined />
                    ),
                  ]
                : []),
            ],
          },
        ]
      : []),
  ];

  const showCollapsedLogo = Boolean(collapsed && !isMobile);
  const content = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        height: "100%",
        minHeight: "100vh",
      }}
    >
      <div
        style={{
          height: 96,
          position: "relative",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
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
            pointerEvents: "none",
          }}
        >
          <LogoDisplay size="small" />
        </div>
        <img
          src={isDark ? logoPathMobileDark : logoPathMobileLight}
          alt="TNT Logo"
          style={{
            width: 72,
            height: 72,
            objectFit: "contain",
            opacity: showCollapsedLogo ? 1 : 0,
          }}
        />
      </div>

      <div
        style={{
          display: "flex",
          flex: 1,
          flexDirection: "column",
          minHeight: 0,
          background: "#a8071a",
        }}
      >
        <Menu
          theme={isDark ? "dark" : "light"}
          mode="inline"
          selectedKeys={[selectedKey]}
          items={items}
          onClick={() => {
            if (isMobile) {
              onClose?.();
            }
          }}
          style={{ background: "#a8071a", border: "none", flexShrink: 0 }}
          className="admin-navigation-menu"
        />

        <Menu
          theme={isDark ? "dark" : "light"}
          mode="inline"
          selectable={false}
          items={[
            ...(tournament?.isDisplayed
              ? [
                  getItem(
                    <Link
                      to={`/online-tournaments/${tournament.slug}/presentation`}
                    >
                      {t.admin.viewTournament}
                    </Link>,
                    "view-tournament",
                    <EyeOutlined />
                  ),
                ]
              : []),
            getItem(
              <Link to="/">{t.admin.backToSite}</Link>,
              "back-to-site",
              <ArrowLeftOutlined />
            ),
          ]}
          onClick={() => {
            if (isMobile) {
              onClose?.();
            }
          }}
          style={
            {
              background: "#a8071a",
              border: "none",
              flexShrink: 0,
              "--admin-back-bg": siderBg,
              "--admin-back-hover-bg": isDark ? "#112545" : "#e6f4ff",
              "--admin-back-color": isDark ? "#fff" : "rgba(0, 0, 0, 0.88)",
            } as React.CSSProperties
          }
          className="admin-back-menu"
        />
        <div style={{ flex: 1 }} />
      </div>
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
        {content}
      </Drawer>
    );
  }

  return (
    <Sider
      trigger={null}
      collapsible
      collapsed={collapsed}
      style={{ background: siderBg, overflow: "auto" }}
    >
      {content}
    </Sider>
  );
}
