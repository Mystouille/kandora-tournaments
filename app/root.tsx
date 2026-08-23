import {
  isRouteErrorResponse,
  Links,
  Meta,
  Outlet,
  Scripts,
  ScrollRestoration,
  useLocation,
} from "react-router";

import type { Route } from "./+types/root";
import "./app.css";
import { Navigation } from "./components/Navigation";
import { CookieConsent } from "./components/CookieConsent";
import { ThemeProvider } from "./contexts/ThemeContext";
import { LocaleProvider } from "./contexts/LocaleContext";
import { TelemetryProvider } from "./contexts/TelemetryContext";
import { TileSetProvider } from "./contexts/TileSetContext";
import { GlossaryProvider } from "./contexts/GlossaryContext";
import { FormFactorProvider } from "./contexts/FormFactorContext";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { HomeOutlined, LoginOutlined, LockOutlined } from "@ant-design/icons";
import { basePath } from "./utils/basePath";
import {
  createThemeBootstrapScript,
  resolveUiPreferences,
} from "~/core/ui/uiPreferences";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 5 * 60 * 1000, // 5 minutes
      gcTime: 10 * 60 * 1000, // 10 minutes (garbage collection)
      refetchOnWindowFocus: false,
    },
  },
});

export const links: Route.LinksFunction = () => [
  { rel: "icon", href: `${basePath}/favicon.ico` },
  { rel: "preconnect", href: "https://fonts.googleapis.com" },
  {
    rel: "preconnect",
    href: "https://fonts.gstatic.com",
    crossOrigin: "anonymous",
  },
  {
    rel: "stylesheet",
    href: "https://fonts.googleapis.com/css2?family=Inter:opsz,wght@14..32,400..700&family=Yuji+Syuku&display=swap",
  },
];

export async function loader({ request }: Route.LoaderArgs) {
  const cookieHeader = request.headers.get("Cookie") || "";
  const userAgent = request.headers.get("User-Agent") || "";
  const isProbablyMobile =
    /Android|iPhone|iPad|iPod|Mobile|Windows Phone/i.test(userAgent);
  const uiPreferenceCookieDomain =
    process.env.AUTH_COOKIE_DOMAIN?.trim() || null;
  const preferences = resolveUiPreferences(
    cookieHeader,
    Boolean(uiPreferenceCookieDomain)
  );
  return {
    theme: preferences.theme,
    locale: preferences.locale,
    hasSharedTheme: preferences.hasSharedTheme,
    uiPreferenceCookieDomain,
    isProbablyMobile,
  };
}

// Inline script to expose viewport width before React hydrates
const viewportBootstrapScript = `
(function() {
  try {
    window.__INITIAL_VIEWPORT_WIDTH__ = window.innerWidth;
  } catch (e) {}
})()
`;

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1, viewport-fit=cover"
        />
        <script dangerouslySetInnerHTML={{ __html: viewportBootstrapScript }} />
        <Meta />
        <Links />
      </head>
      <body>
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App({ loaderData }: Route.ComponentProps) {
  const location = useLocation();
  const initialTheme = (loaderData?.theme as "light" | "dark") || "dark";
  const initialLocale = (loaderData?.locale as "en" | "fr") || "fr";
  const initialIsMobile = Boolean(loaderData?.isProbablyMobile);
  const uiPreferenceCookieDomain = loaderData?.uiPreferenceCookieDomain || null;
  const antiFlickerScript = createThemeBootstrapScript(
    Boolean(uiPreferenceCookieDomain)
  );
  const isStandaloneSignIn = location.pathname === `${basePath}/sign-in`;

  return (
    <>
      <script dangerouslySetInnerHTML={{ __html: antiFlickerScript }} />
      <QueryClientProvider client={queryClient}>
        <LocaleProvider
          initialLocale={initialLocale}
          sharedCookieDomain={uiPreferenceCookieDomain}
        >
          <ThemeProvider
            initialTheme={initialTheme}
            sharedCookieDomain={uiPreferenceCookieDomain}
            hasSharedTheme={Boolean(loaderData?.hasSharedTheme)}
          >
            <FormFactorProvider ssrIsMobile={initialIsMobile}>
              <TileSetProvider>
                <GlossaryProvider enabled={!isStandaloneSignIn}>
                  <TelemetryProvider endpoint={`${basePath}/api/telemetry`}>
                    <Navigation>
                      <Outlet />
                    </Navigation>
                    {!isStandaloneSignIn && <CookieConsent />}
                  </TelemetryProvider>
                </GlossaryProvider>
              </TileSetProvider>
            </FormFactorProvider>
          </ThemeProvider>
        </LocaleProvider>
      </QueryClientProvider>
    </>
  );
}

export function ErrorBoundary({ error }: Route.ErrorBoundaryProps) {
  if (isRouteErrorResponse(error) && error.status === 403) {
    return <ForbiddenPage />;
  }
  let message = "Oops!";
  let details = "An unexpected error occurred.";
  let stack: string | undefined;

  if (isRouteErrorResponse(error)) {
    message = error.status === 404 ? "404" : "Error";
    details =
      error.status === 404
        ? "The requested page could not be found."
        : error.statusText || details;
  } else if (import.meta.env.DEV && error && error instanceof Error) {
    details = error.message;
    stack = error.stack;
  }

  return (
    <main className="container mx-auto p-4 pt-16">
      <h1>{message}</h1>
      <p>{details}</p>
      {stack && (
        <pre className="w-full overflow-x-auto p-4">
          <code>{stack}</code>
        </pre>
      )}
    </main>
  );
}

function ForbiddenPage(): React.ReactElement {
  const signIn = (): void => {
    void import("./utils/discord-oauth")
      .then(({ DiscordOAuth }) => {
        DiscordOAuth.redirectToDiscord();
      })
      .catch((error) => {
        console.error("Failed to start Discord login:", error);
      });
  };

  return (
    <main className="min-h-screen bg-zinc-950 px-6 text-zinc-100">
      <div className="mx-auto flex min-h-screen max-w-xl flex-col justify-center">
        <div className="mb-6 flex h-12 w-12 items-center justify-center border border-emerald-500/40 bg-emerald-950 text-emerald-300">
          <LockOutlined className="text-xl" aria-hidden="true" />
        </div>
        <p className="mb-2 text-xs font-semibold uppercase text-emerald-400">
          403 Forbidden
        </p>
        <h1 className="mb-3 text-3xl font-semibold">Sign in to continue</h1>
        <p className="mb-8 max-w-lg text-sm leading-6 text-zinc-400">
          The game lobby, active matches, and live spectators are available to
          signed-in members. Archived replays remain public.
        </p>
        <div className="flex flex-wrap gap-3">
          <button
            type="button"
            onClick={signIn}
            className="inline-flex h-10 items-center gap-2 bg-emerald-600 px-4 text-sm font-semibold text-white hover:bg-emerald-500"
          >
            <LoginOutlined aria-hidden="true" />
            Sign in with Discord
          </button>
          <a
            href={basePath || "/"}
            className="inline-flex h-10 items-center gap-2 border border-zinc-700 px-4 text-sm font-semibold text-zinc-200 hover:bg-zinc-900"
          >
            <HomeOutlined aria-hidden="true" />
            Back to tournaments
          </a>
        </div>
      </div>
    </main>
  );
}
