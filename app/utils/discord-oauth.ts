// Discord OAuth Configuration
// Only public values are exposed to the browser
import { basePath } from "./basePath";

const DISCORD_CLIENT_ID = import.meta.env.VITE_DISCORD_CLIENT_ID;
const DISCORD_SCOPE = "identify";

const DISCORD_REDIRECT_URI = basePath + "/auth/discord/callback";

const getRedirectUri = (): string => {
  const baseUrl =
    typeof window !== "undefined"
      ? window.location.origin
      : import.meta.env.VITE_APP_BASE_URL;
  return baseUrl + DISCORD_REDIRECT_URI;
};

export interface DiscordUser {
  id: string;
  username: string;
  discriminator: string;
  avatar: string | null;
  email: string;
  verified: boolean;
}

export interface DiscordAuthResponse {
  success: boolean;
  user?: DiscordUser;
  error?: string;
  merged?: boolean;
  isNewUser?: boolean;
}

export class DiscordOAuth {
  private static readonly BASE_URL = "https://discord.com/api/oauth2";

  static getAuthURL(): string {
    if (!DISCORD_CLIENT_ID) {
      throw new Error(
        "Discord client ID is not configured. Please try clearing your browser cache and refreshing the page."
      );
    }

    const redirectUri = getRedirectUri();

    const state = this.generateState();
    const params = new URLSearchParams({
      client_id: DISCORD_CLIENT_ID,
      redirect_uri: redirectUri,
      response_type: "code",
      scope: DISCORD_SCOPE,
      state,
      prompt: "none",
    });

    // Store state in a cookie so the server-side loader can verify it
    document.cookie = `discord_oauth_state=${state}; path=/; max-age=600; samesite=lax`;

    // Save the current page so we can redirect back after login
    const returnTo = window.location.pathname + window.location.search;
    document.cookie = `discord_return_to=${encodeURIComponent(returnTo)}; path=/; max-age=600; samesite=lax`;

    const authURL = `${this.BASE_URL}/authorize?${params.toString()}`;
    console.log("Generated Discord Auth URL:", authURL);
    return authURL;
  }

  /**
   * Exchange authorization code for access token via server-side API
   */
  static async exchangeCodeForToken(
    code: string,
    state: string
  ): Promise<DiscordAuthResponse> {
    try {
      const redirectUri = getRedirectUri();
      const res = await fetch(`${basePath}/api/auth/discord-callback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ code, state, redirectUri }),
      });
      const data = await res.json();
      if (!res.ok) {
        return { success: false, error: data.error || "Authentication failed" };
      }
      return data;
    } catch (err) {
      console.error("Discord code exchange failed:", err);
      return { success: false, error: "Network error during authentication" };
    }
  }

  private static generateState(): string {
    return (
      Math.random().toString(36).substring(2, 15) +
      Math.random().toString(36).substring(2, 15)
    );
  }

  static redirectToDiscord(): void {
    const authURL = this.getAuthURL();
    console.log("Redirecting to Discord OAuth:", authURL);
    window.location.href = authURL;
  }

  /**
   * Redirect to Discord OAuth in "link account" mode.
   * Sets a cookie so the server-side callback knows to link instead of login.
   */
  static redirectToDiscordForLink(): void {
    document.cookie =
      "discord_link_mode=true; path=/; max-age=600; samesite=lax";
    const authURL = this.getAuthURL();
    window.location.href = authURL;
  }
}
