export interface ImportResult {
  success: boolean;
  teamsProcessed: number;
  playersProcessed?: number;
  usersCreated: number;
  teamsUpdated: number;
}

export interface DiscordMemberOption {
  discordId: string;
  username: string;
  displayName: string;
  avatarUrl: string | null;
}

export function formatString(
  template: string,
  replacements: Record<string, string | number>
): string {
  return Object.entries(replacements).reduce(
    (str, [key, val]) => str.replace(`{${key}}`, String(val)),
    template
  );
}

export function compositeDisplayName(user: {
  name: string;
  firstName: string | null;
  lastName: string | null;
}): string {
  if (user.firstName) {
    const lastInitial = user.lastName ? ` ${user.lastName.charAt(0)}.` : "";
    return `${user.firstName}${lastInitial}`;
  }
  return user.name;
}

export function getPlatformLabel(platform: string | undefined): string {
  if (platform === "MAJSOUL") {
    return "Mahjong Soul";
  }
  if (platform === "RIICHICITY") {
    return "Riichi City";
  }
  if (platform === "TENHOU") {
    return "Tenhou";
  }
  return platform ?? "";
}
