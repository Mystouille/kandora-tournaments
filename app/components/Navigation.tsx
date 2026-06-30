import React, { useState, useEffect, useCallback } from "react";
import { Layout, theme, Form, message } from "antd";
import { useAppTheme } from "../contexts/ThemeContext";
import { basePath } from "../utils/basePath";
import { Sidebar } from "./Sidebar";
import { Header } from "./Header";
import { LoginModal } from "./LoginModal";
import { RegisterModal } from "./RegisterModal";
import { ForgotPasswordModal } from "./ForgotPasswordModal";
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
  const [isLoginModalVisible, setIsLoginModalVisible] = useState(false);
  const [isRegisterModalVisible, setIsRegisterModalVisible] = useState(false);
  const [isForgotPasswordVisible, setIsForgotPasswordVisible] = useState(false);
  const [currentUser, setCurrentUser] = useState(null);
  const [authLoading, setAuthLoading] = useState(true);
  const [loginForm] = Form.useForm();
  const [registerForm] = Form.useForm();
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

  // Listen for a custom event to open the login modal from anywhere
  useEffect(() => {
    const handler = () => {
      setIsLoginModalVisible(true);
    };
    window.addEventListener("open-login-modal", handler);
    return () => window.removeEventListener("open-login-modal", handler);
  }, []);

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

  const handleLogin = () => {
    setIsLoginModalVisible(true);
  };

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

  const handleAuthSuccess = async (user: any) => {
    // Set immediately for snappy UI, then verify from server cookie
    setCurrentUser(user);
    setIsLoginModalVisible(false);
    setIsRegisterModalVisible(false);
    message.success(
      t.auth.welcomeUser.replace("{username}", user.username || user.name)
    );
    // Re-fetch from server to confirm cookie-based session is established
    await refreshSession();
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

  const handleLoginModalCancel = () => {
    setIsLoginModalVisible(false);
    loginForm.resetFields();
  };

  const handleRegisterModalCancel = () => {
    setIsRegisterModalVisible(false);
    registerForm.resetFields();
  };

  const handleShowRegister = () => {
    setIsLoginModalVisible(false);
    setIsRegisterModalVisible(true);
  };

  const handleShowLogin = () => {
    setIsRegisterModalVisible(false);
    setIsForgotPasswordVisible(false);
    setIsLoginModalVisible(true);
  };

  const handleShowForgotPassword = () => {
    setIsLoginModalVisible(false);
    setIsForgotPasswordVisible(true);
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
            onLogin={handleLogin}
            onLogout={handleLogout}
            currentUser={currentUser}
            authLoading={authLoading}
          />

          <LoginModal
            visible={isLoginModalVisible}
            onCancel={handleLoginModalCancel}
            onSuccess={handleAuthSuccess}
            onRegister={handleShowRegister}
            onForgotPassword={handleShowForgotPassword}
            onDiscordLogin={handleDiscordLogin}
            form={loginForm}
          />

          <RegisterModal
            visible={isRegisterModalVisible}
            onCancel={handleRegisterModalCancel}
            onSuccess={() => {
              setIsRegisterModalVisible(false);
              setIsLoginModalVisible(true);
              message.info(t.auth.accountCreated);
            }}
            form={registerForm}
          />

          <ForgotPasswordModal
            visible={isForgotPasswordVisible}
            onCancel={() => setIsForgotPasswordVisible(false)}
            onBackToLogin={handleShowLogin}
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
