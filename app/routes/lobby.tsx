import GameLobby, { type LobbyLoaderData } from "~/game/routes/lobby";
import { requireGameEnabled, getClientGameFlag } from "~/game/feature-gate";
import { listPresets } from "~/game/rules/presets";

export async function loader(): Promise<LobbyLoaderData> {
	requireGameEnabled();
	return {
		flag: getClientGameFlag(),
		presets: listPresets().map(({ id, displayName, description }) => ({
			id,
			displayName,
			description,
		})),
	};
}

export default GameLobby;