import { readFileSync } from "fs";
import { join } from "path";
import { discordBotConfig } from "config";

export interface ServerConfig {
  id: string;
  name: string;
  isMain: boolean;
  adminRoleId?: string;
  editorRoleId?: string;
  notificationChannelId?: string;
}

let serversCache: ServerConfig[] | null = null;

function loadServers(): ServerConfig[] {
  if (serversCache) {
    return serversCache;
  }

  let raw: string;

  const serversJson = discordBotConfig()?.SERVERS_JSON;
  if (serversJson) {
    raw = serversJson;
  } else {
    const filePath = join(process.cwd(), "servers.json");
    try {
      raw = readFileSync(filePath, "utf-8");
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        throw new Error(
          "SERVERS_JSON env var not set and servers.json not found. Set SERVERS_JSON or copy servers.json.template to servers.json."
        );
      }
      throw error;
    }
  }

  const servers: ServerConfig[] = JSON.parse(raw);

  if (!Array.isArray(servers) || servers.length === 0) {
    throw new Error("servers.json must be a non-empty array");
  }

  const mainServers = servers.filter((s) => s.isMain);
  if (mainServers.length !== 1) {
    throw new Error("Exactly one server must have isMain: true");
  }

  for (const server of servers) {
    if (!server.id || !server.name) {
      throw new Error("Each server must have an id and name");
    }
  }

  serversCache = servers;
  return servers;
}

export function getServers(): ServerConfig[] {
  return loadServers();
}

export function getMainServer(): ServerConfig {
  return loadServers().find((s) => s.isMain)!;
}

export function getAllServerIds(): string[] {
  return loadServers().map((s) => s.id);
}

export function getServerById(id: string): ServerConfig | undefined {
  return loadServers().find((s) => s.id === id);
}
