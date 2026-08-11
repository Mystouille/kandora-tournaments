import { redirect, type LoaderFunctionArgs } from "react-router";
import {
  asUiLocale,
  serializeLocalePreferenceCookies,
} from "~/core/ui/uiPreferences";

export async function loader({ request }: LoaderFunctionArgs) {
  const url = new URL(request.url);
  const basePath = (import.meta.env.BASE_URL || "/").replace(/^\/|\/$/g, "");
  const stripped = basePath
    ? url.pathname.replace(new RegExp(`^/${basePath}`), "")
    : url.pathname;
  const segments = stripped.split("/").filter(Boolean);
  const locale = asUiLocale(segments[0] ?? null);
  if (!locale) {
    throw new Response("Unsupported locale", { status: 400 });
  }

  const rest = segments.slice(1).join("/");
  const targetPath = rest ? `/${rest}` : "/";
  const targetUrl = `${targetPath}${url.search}`;
  const headers = new Headers();
  const sharedCookieDomain =
    process.env.AUTH_COOKIE_DOMAIN?.trim() || null;
  const secure =
    url.protocol === "https:" || process.env.NODE_ENV === "production";

  for (const cookie of serializeLocalePreferenceCookies(locale, {
    domain: sharedCookieDomain,
    secure,
  })) {
    headers.append("Set-Cookie", cookie);
  }

  return redirect(targetUrl, { headers });
}