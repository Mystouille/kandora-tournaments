import { useEffect } from "react";
import { useNavigate } from "react-router";
import { Spin, Alert, Button } from "antd";
import { useLocale } from "../../../contexts/LocaleContext";
import type { Route } from "./+types/callback";

const DISCORD_INVITE_URL = "https://discord.gg/YHwpQ6hcng";

// Re-export the server-side loader (handles Discord OAuth code exchange + redirect)
export { loader } from "./callback.server";

export function meta() {
  return [
    { title: "Discord Authentication - TNT Paris Mahjong" },
    { name: "description", content: "Processing Discord authentication..." },
  ];
}

export default function DiscordCallback({ loaderData }: Route.ComponentProps) {
  const navigate = useNavigate();
  const { t } = useLocale();
  const data = loaderData as { error?: string } | undefined;

  // If there's no error from the loader, the redirect already happened.
  // This component only renders when there's an error to show.
  useEffect(() => {
    if (!data?.error) {
      navigate("/", { replace: true });
    }
  }, [data, navigate]);

  if (data?.error === "not_in_server") {
    return (
      <div style={{ maxWidth: "480px", margin: "0 auto", marginTop: "60px" }}>
        <Alert
          title={t.auth.notInServerTitle}
          description={t.auth.notInServerDesc}
          type="warning"
          showIcon
          action={
            <div
              style={{ display: "flex", flexDirection: "column", gap: "8px" }}
            >
              <Button
                type="primary"
                href={DISCORD_INVITE_URL}
                target="_blank"
                rel="noopener noreferrer"
              >
                {t.home.joinDiscord}
              </Button>
              <a
                href="/"
                style={{ textDecoration: "none", textAlign: "center" }}
              >
                {t.nav.home}
              </a>
            </div>
          }
        />
      </div>
    );
  }

  if (data?.error) {
    return (
      <div style={{ maxWidth: "400px", margin: "0 auto", marginTop: "60px" }}>
        <Alert
          title={t.auth.authError || "Authentication Error"}
          description={data.error}
          type="error"
          showIcon
          action={
            <a href="/" style={{ textDecoration: "none" }}>
              {t.nav.home || "Return Home"}
            </a>
          }
        />
      </div>
    );
  }

  return (
    <div
      style={{
        display: "flex",
        justifyContent: "center",
        alignItems: "center",
        minHeight: "60vh",
        flexDirection: "column",
        gap: "16px",
      }}
    >
      <Spin size="large" />
    </div>
  );
}
