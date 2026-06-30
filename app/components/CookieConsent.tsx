import React, { useState, useEffect } from "react";
import { Button, theme } from "antd";
import { useLocale } from "../contexts/LocaleContext";

const COOKIE_CONSENT_KEY = "cookie_consent";

export function CookieConsent() {
  const [visible, setVisible] = useState(false);
  const { t } = useLocale();
  const {
    token: { colorBgElevated, colorText, colorBorder, boxShadow },
  } = theme.useToken();

  useEffect(() => {
    const consent = localStorage.getItem(COOKIE_CONSENT_KEY);
    if (!consent) {
      setVisible(true);
    }
  }, []);

  const handleAccept = () => {
    localStorage.setItem(COOKIE_CONSENT_KEY, "accepted");
    setVisible(false);
  };

  if (!visible) {
    return null;
  }

  return (
    <div
      style={{
        position: "fixed",
        bottom: 24,
        left: "50%",
        transform: "translateX(-50%)",
        zIndex: 1100,
        display: "flex",
        alignItems: "center",
        gap: 16,
        padding: "12px 20px",
        background: colorBgElevated,
        color: colorText,
        border: `1px solid ${colorBorder}`,
        borderRadius: 8,
        boxShadow,
        maxWidth: 480,
        fontSize: 13,
      }}
    >
      <span>{t.cookie.message}</span>
      <Button type="primary" size="small" onClick={handleAccept}>
        OK
      </Button>
    </div>
  );
}
