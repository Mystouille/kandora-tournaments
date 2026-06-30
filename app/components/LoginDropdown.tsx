import React from "react";
import { Avatar, Button, theme, Tooltip } from "antd";
import { LoginOutlined, LogoutOutlined, UserOutlined } from "@ant-design/icons";
import { useNavigate } from "react-router";
import { useLocale } from "../contexts/LocaleContext";

interface LoginDropdownProps {
  onLogin: () => void;
  onLogout: () => void;
  currentUser: any;
  authLoading?: boolean;
}

export function LoginDropdown({
  onLogin,
  onLogout,
  currentUser,
  authLoading,
}: LoginDropdownProps) {
  const { t } = useLocale();
  const navigate = useNavigate();
  const { token: themeToken } = theme.useToken();

  if (authLoading) {
    return (
      <Avatar icon={<UserOutlined />} size={40} style={{ opacity: 0.4 }} />
    );
  }

  if (currentUser) {
    const avatarUrl = currentUser.avatarUrl ?? null;
    const displayName = currentUser.firstName || currentUser.name || "";

    return (
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <Tooltip title={t.account.title}>
          <div
            onClick={() => navigate("/account")}
            style={{ cursor: "pointer" }}
          >
            {avatarUrl ? (
              <Avatar src={avatarUrl} size={40} />
            ) : (
              <Avatar icon={<UserOutlined />} size={40} />
            )}
          </div>
        </Tooltip>
        <div
          className="login-dropdown-user-info"
          style={{ display: "flex", flexDirection: "column", lineHeight: 1.2 }}
        >
          <span
            style={{ fontSize: "12px", color: themeToken.colorTextSecondary }}
          >
            {displayName}
          </span>
          <Button
            type="text"
            icon={<LogoutOutlined />}
            onClick={onLogout}
            style={{
              fontSize: "14px",
              padding: 0,
              height: "auto",
              color: themeToken.colorText,
            }}
          >
            {t.auth.logout}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <Button
      type="text"
      icon={<LoginOutlined />}
      onClick={onLogin}
      style={{
        fontSize: "18px",
      }}
    >
      {t.auth.login}
    </Button>
  );
}
