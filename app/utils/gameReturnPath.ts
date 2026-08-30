const LOCAL_ORIGIN = "https://kandora.local";

function containsControlCharacter(value: string): boolean {
  return Array.from(value).some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}

export function stripAppBasePath(path: string, basePath: string): string {
  const normalizedBasePath = basePath.replace(/\/$/, "");
  if (!normalizedBasePath || normalizedBasePath === "/") {
    return path;
  }
  if (path === normalizedBasePath) {
    return "/";
  }
  if (path.startsWith(`${normalizedBasePath}/`)) {
    return path.slice(normalizedBasePath.length);
  }
  return path;
}

export function normalizeLocalReturnPath(
  value: string | null | undefined,
  fallback = "/"
): string {
  if (
    !value ||
    !value.startsWith("/") ||
    value.startsWith("//") ||
    value.includes("\\") ||
    containsControlCharacter(value)
  ) {
    return fallback;
  }

  try {
    const parsed = new URL(value, LOCAL_ORIGIN);
    const decodedPathname = decodeURIComponent(parsed.pathname);
    if (
      parsed.origin !== LOCAL_ORIGIN ||
      decodedPathname.startsWith("//") ||
      decodedPathname.includes("\\") ||
      containsControlCharacter(decodedPathname)
    ) {
      return fallback;
    }
    return `${parsed.pathname}${parsed.search}`;
  } catch {
    return fallback;
  }
}

export function normalizeGameReturnPath(
  value: string | null | undefined,
  fallback = "/lobby"
): string {
  const normalized = normalizeLocalReturnPath(value, "");
  if (!normalized) {
    return fallback;
  }
  const { pathname } = new URL(normalized, LOCAL_ORIGIN);
  const isGamePath =
    pathname === "/lobby" ||
    pathname === "/mobile-auth/complete" ||
    /^\/game\/[^/]+$/.test(pathname) ||
    /^\/spectate\/[^/]+$/.test(pathname) ||
    /^\/watch\/live\/[^/]+$/.test(pathname);
  return isGamePath ? normalized : fallback;
}

export function gameReturnPathFromRequest(
  request: Request,
  basePath = ""
): string {
  const url = new URL(request.url);
  const path = stripAppBasePath(`${url.pathname}${url.search}`, basePath);
  return normalizeGameReturnPath(path);
}

export function gameSignInPath(returnTo: string): string {
  const params = new URLSearchParams({
    returnTo: normalizeGameReturnPath(returnTo),
  });
  return `/sign-in?${params.toString()}`;
}

export function localReturnPathFromRequest(
  request: Request,
  basePath = ""
): string {
  const url = new URL(request.url);
  return normalizeLocalReturnPath(
    stripAppBasePath(`${url.pathname}${url.search}`, basePath)
  );
}

export function authSignInPath(returnTo: string): string {
  const params = new URLSearchParams({
    mode: "auth",
    returnTo: normalizeLocalReturnPath(returnTo),
  });
  return `/sign-in?${params.toString()}`;
}
