import { useState } from "react";
import { Button, Alert, theme } from "antd";
import {
  HomeOutlined,
  LinkOutlined,
  LockOutlined,
  LoginOutlined,
} from "@ant-design/icons";
import { Link, redirect } from "react-router";
import { LanguageSwitcher } from "~/components/LanguageSwitcher";
import { LogoDisplay } from "~/components/LogoDisplay";
import { ThemeToggle } from "~/components/ThemeToggle";
import { useLocale } from "~/contexts/LocaleContext";
import {
  evaluateGameAccess,
  type GameAccessResult,
} from "~/utils/gameAuth.server";
import {
  normalizeGameReturnPath,
  normalizeLocalReturnPath,
} from "~/utils/gameReturnPath";
import { getAuthenticatedUser } from "~/utils/jwt.server";

type DeniedGameAccessStatus = Exclude<GameAccessResult["status"], "allowed">;

export interface SignInLoaderData {
  status: DeniedGameAccessStatus;
  returnTo: string;
  authOnly: boolean;
}

export function meta() {
  return [
    { title: "Sign in - TNT Paris Mahjong" },
    {
      name: "description",
      content: "Sign in to continue to TNT Paris Mahjong.",
    },
  ];
}

export async function loader({
  request,
}: {
  request: Request;
}): Promise<SignInLoaderData> {
  const url = new URL(request.url);
  if (url.searchParams.get("mode") === "auth") {
    const returnTo = normalizeLocalReturnPath(
      url.searchParams.get("returnTo"),
      "/"
    );
    const authenticatedUser = await getAuthenticatedUser(request);
    if (authenticatedUser) {
      throw redirect(returnTo);
    }
    return { status: "signed_out", returnTo, authOnly: true };
  }
  const returnTo = normalizeGameReturnPath(url.searchParams.get("returnTo"));
  const access = await evaluateGameAccess(request);
  if (access.status === "allowed") {
    throw redirect(returnTo);
  }
  return { status: access.status, returnTo, authOnly: false };
}

export default function SignInPage({
  loaderData,
}: {
  loaderData: SignInLoaderData;
}) {
  const { t } = useLocale();
  const { token } = theme.useToken();
  const [oauthError, setOauthError] = useState<string | null>(null);
  const canConnectDiscord =
    loaderData.status === "signed_out" ||
    loaderData.status === "discord_unlinked";
  const content = loaderData.authOnly
    ? t.gameAccess.authOnly
    : t.gameAccess[loaderData.status];
  const eyebrow = loaderData.authOnly
    ? t.gameAccess.authOnly.eyebrow
    : t.gameAccess.eyebrow;

  const connectDiscord = (): void => {
    setOauthError(null);
    void import("~/utils/discord-oauth")
      .then(({ DiscordOAuth }) => {
        if (loaderData.status === "discord_unlinked") {
          DiscordOAuth.redirectToDiscordForLink();
          return;
        }
        DiscordOAuth.redirectToDiscord();
      })
      .catch((error) => {
        console.error("Failed to start Discord login:", error);
        setOauthError(t.gameAccess.oauthError);
      });
  };

  return (
    <main
      style={{
        minHeight: "100vh",
        color: token.colorText,
        backgroundColor: token.colorBgLayout,
        backgroundImage: `linear-gradient(${token.colorBorderSecondary}55 1px, transparent 1px), linear-gradient(90deg, ${token.colorBorderSecondary}55 1px, transparent 1px)`,
        backgroundSize: "32px 32px",
        padding: "20px clamp(16px, 4vw, 48px)",
        boxSizing: "border-box",
        width: "100%",
        overflowX: "hidden",
        display: "grid",
        gridTemplateRows: "auto 1fr auto",
      }}
    >
      <header
        style={{
          minHeight: 64,
          minWidth: 0,
          width: "100%",
          display: "grid",
          gridTemplateColumns: "minmax(0, 180px) auto",
          alignItems: "center",
          gap: 16,
        }}
      >
        <Link
          to="/"
          aria-label={t.gameAccess.backToTournaments}
          style={{
            display: "block",
            height: 64,
            minWidth: 0,
            overflow: "hidden",
          }}
        >
          <LogoDisplay size="small" />
        </Link>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <LanguageSwitcher />
          <ThemeToggle />
        </div>
      </header>

      <section
        style={{
          width: "100%",
          maxWidth: 560,
          minWidth: 0,
          boxSizing: "border-box",
          margin: "0 auto",
          alignSelf: "center",
          padding: "clamp(28px, 6vw, 52px)",
          border: `1px solid ${token.colorBorderSecondary}`,
          borderRadius: 8,
          background: token.colorBgContainer,
          boxShadow: token.boxShadowSecondary,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            display: "grid",
            placeItems: "center",
            marginBottom: 24,
            color: token.colorPrimary,
            border: `1px solid ${token.colorPrimaryBorder}`,
            background: token.colorPrimaryBg,
          }}
        >
          <LockOutlined style={{ fontSize: 20 }} aria-hidden="true" />
        </div>
        <p
          style={{
            margin: "0 0 8px",
            color: token.colorPrimary,
            fontSize: 12,
            fontWeight: 700,
            textTransform: "uppercase",
          }}
        >
          {eyebrow}
        </p>
        <h1
          style={{
            margin: "0 0 12px",
            color: token.colorTextHeading,
            fontSize: "clamp(28px, 6vw, 40px)",
            lineHeight: 1.12,
            fontWeight: 700,
          }}
        >
          {content.title}
        </h1>
        <p
          style={{
            margin: "0 0 28px",
            color: token.colorTextSecondary,
            fontSize: 15,
            lineHeight: 1.7,
          }}
        >
          {content.description}
        </p>

        {oauthError && (
          <Alert
            type="error"
            title={oauthError}
            closable
            onClose={() => setOauthError(null)}
            style={{ marginBottom: 20 }}
          />
        )}

        <div style={{ display: "flex", flexWrap: "wrap", gap: 12 }}>
          {canConnectDiscord && (
            <Button
              type="primary"
              size="large"
              icon={
                loaderData.status === "discord_unlinked" ? (
                  <LinkOutlined />
                ) : (
                  <LoginOutlined />
                )
              }
              onClick={connectDiscord}
              style={{
                flex: "1 1 210px",
                minWidth: 0,
                height: 44,
                background: "#5865f2",
                borderColor: "#5865f2",
              }}
            >
              {loaderData.status === "discord_unlinked"
                ? t.gameAccess.linkDiscord
                : t.auth.continueWithDiscord}
            </Button>
          )}
          <Link to="/" style={{ flex: "1 1 180px", minWidth: 0 }}>
            <Button
              size="large"
              icon={<HomeOutlined />}
              style={{ width: "100%", height: 44 }}
            >
              {t.gameAccess.backToTournaments}
            </Button>
          </Link>
        </div>
      </section>

      <div style={{ minHeight: 40 }} aria-hidden="true" />
    </main>
  );
}
