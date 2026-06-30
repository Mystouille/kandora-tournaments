import React, { useState, useEffect, useCallback } from "react";
import { Layout, theme, message } from "antd";
import { useAppTheme } from "../contexts/ThemeContext";
import { basePath } from "../utils/basePath";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { GlossaryPanel } from "./GlossaryPanel";
import { useLocale } from "../contexts/LocaleContext";
import { useIsMobile } from "../hooks/useIsMobile";
import { useSwipeGesture } from "../hooks/useSwipeGesture";
import { useGlossary } from "../contexts/GlossaryContext";
import { useTileSet } from "../contexts/TileSetContext";
import { TileSetName } from "./mahjong/HandImage";

interface NavigationProps {
  children: React.ReactNode;
}

export function Navigation({ children }: NavigationProps) {
  const isMobile = useIsMobile();
  const [collapsed, setCollapsed] = useState(() => isMobile);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const { t } = useLocale();
  const { customTokens } = useAppTheme();
  const { setTileSet } = useTileSet();
  const { activeTerm, closeTerm } = useGlossary();
  const {
    token: { colorBgContainer, borderRadiusLG },
  } = theme.useToken();

  // Swipe gestures for mobile
  useSwipeGesture({
    onSwipeRight: () => {
      if (activeTerm) {
        closeTerm();
      } else if (collapsed) {
        setCollapsed(false);
      }
    },
    onSwipeLeft: () => {
      if (!collapsed) {
        setCollapsed(true);
      }
    },
    onSwipeDown: () => {
      if (activeTerm) {
        closeTerm();
      }
    },
  });

  useEffect(() => {
    if (isMobile) {
      setCollapsed((current) => {
        if (current) {
          return current;
        }
        return true;
      });
    }
  }, [isMobile]);

  // Fetch user session from the JWT cookie
  const refreshSession = useCallback(async () => {
    try {
      const res = await fetch(`${basePath}/api/auth/me`);
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.user) {
          setCurrentUser(data.user);
          const userTileSet = data.user.preferences?.tileSet;
          if (userTileSet && Object.values(TileSetName).includes(userTileSet)) {
            setTileSet(userTileSet as TileSetName);
          }
          return;
        }
      }
      setCurrentUser(null);
    } catch {
      setCurrentUser(null);
    }
  }, [setTileSet]);

  // Check for persisted user session via JWT cookie on mount
  useEffect(() => {
    refreshSession().finally(() => setAuthLoading(false));
  }, [refreshSession]);

  // Handle Discord OAuth redirect result (query params from server-side callback)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("discord_auth") === "success") {
      const username = params.get("username") || "";
      const merged = params.get("merged") === "true";

      // Show success messages
      if (merged) {
        message.info(t.auth.accountsMerged, 6);
      }
      message.success(t.auth.welcomeUser.replace("{username}", username));

      // Refresh session to pick up the new auth cookie
      refreshSession();

      // Clean up the URL query params
      const cleanUrl = window.location.pathname;
      const remaining = new URLSearchParams();
      params.forEach((v, k) => {
        if (!["discord_auth", "username", "merged", "newUser"].includes(k)) {
          remaining.set(k, v);
        }
      });
      const newUrl = remaining.toString()
        ? `${cleanUrl}?${remaining.toString()}`
        : cleanUrl;
      window.history.replaceState({}, "", newUrl);
    }
  }, []);

  // Listen for a custom event so the Discord callback (or any page) can trigger a session refresh
  useEffect(() => {
    const handler = () => {
      refreshSession();
    };
    window.addEventListener("auth-changed", handler);
    window.addEventListener("profile-updated", handler);
    return () => {
      window.removeEventListener("auth-changed", handler);
      window.removeEventListener("profile-updated", handler);
    };
  }, [refreshSession]);

  // Preload both logo images to avoid reloading on theme switch
  useEffect(() => {
    const preloadImages = () => {
      const darkLogo = new Image();
      const lightLogo = new Image();

      darkLogo.src = customTokens.logoPathDark;
      lightLogo.src = customTokens.logoPathLight;
    };

    preloadImages();
  }, [customTokens]);

  const handleDiscordLogin = () => {
    // Import Discord OAuth utility dynamically to avoid SSR issues
    import("../utils/discord-oauth")
      .then(({ DiscordOAuth }) => {
        console.log("Starting Discord OAuth flow...");
        DiscordOAuth.redirectToDiscord();
      })
      .catch((error) => {
        console.error("Failed to load Discord OAuth:", error);
        // A failed dynamic import usually means the client has stale JS from a
        // previous deployment. Force a full reload so the browser fetches the
        // latest bundle, then the user can try again.
        if (
          error instanceof TypeError &&
          error.message.toLowerCase().includes("failed to fetch")
        ) {
          window.location.reload();
          return;
        }
        message.error(error?.message || "Failed to start Discord login");
      });
  };

  const handleLogout = async () => {
    try {
      await fetch(`${basePath}/api/auth/logout`, { method: "POST" });
    } catch (error) {
      console.error("Logout error:", error);
    }
    setCurrentUser(null);
    window.dispatchEvent(new Event("auth-changed"));
    message.success(t.auth.logoutSuccess);
  };

  return (
    <>
      <Layout hasSider style={{ minHeight: "100vh" }}>
        <Sidebar
          collapsed={collapsed}
          isMobile={isMobile}
          onClose={() => setCollapsed(true)}
          currentUser={currentUser}
        />
        <Layout>
          <Header
            collapsed={collapsed}
            onToggleCollapse={() => setCollapsed(!collapsed)}
            onLogin={handleDiscordLogin}
            onLogout={handleLogout}
            currentUser={currentUser}
            authLoading={authLoading}
          />

          <Layout.Content
            style={{
              margin: isMobile ? "12px 8px" : "24px 16px",
              padding: isMobile ? 12 : 24,
              flex: 1,
              background: colorBgContainer,
              borderRadius: borderRadiusLG,
              overflow: "visible",
            }}
          >
            {children}
          </Layout.Content>
        </Layout>
      </Layout>
      <GlossaryPanel />
    </>
  );
}
