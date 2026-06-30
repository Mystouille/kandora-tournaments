/**
 * Register the bot's slash commands with Discord.
 *
 * Run this whenever a command's structure changes (new options, renamed
 * subcommands, etc.) so Discord picks up the new schema. Editing only the
 * runtime handler does NOT require a redeploy; editing the command builder
 * in `app/bot/commands/**` does.
 *
 * Registers global commands, which Discord may take up to ~1 hour to
 * propagate. The call is idempotent — it overwrites the full command set.
 *
 * Usage: npx tsx scripts/deploy-commands.ts
 * Requires DISCORD_BOT_TOKEN and VITE_DISCORD_CLIENT_ID in the environment.
 */
import "dotenv/config";

import { deployCommands } from "../app/bot/commandUtils";

async function main(): Promise<void> {
  await deployCommands();
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error("Failed to deploy commands:", error);
    process.exit(1);
  });
