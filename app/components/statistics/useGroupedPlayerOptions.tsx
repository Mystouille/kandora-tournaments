import { useMemo, useCallback } from "react";
import { useLocale } from "../../contexts/LocaleContext";
import type { TeamOption, UserOption } from "./types";

interface GroupedOptions {
  label: any;
  options: { label: any; value: string; searchLabel: string }[];
}

/**
 * Shared helper that groups users by team membership in the selected league.
 * Returns grouped option sets for both the player filter select and the pin-player select.
 */
export function useGroupedPlayerOptions(
  users: UserOption[],
  teams: TeamOption[],
  selectedLeague: string | null,
  selectedPlayers: string[],
  setSelectedPlayers: (players: string[]) => void
) {
  const { t } = useLocale();

  // Group users by team membership in the selected league
  const groupedUsers = useMemo(() => {
    const teamsInLeague = selectedLeague
      ? teams.filter((team) => team.leagueId === selectedLeague)
      : [];

    const userTeamMap = new Map<string, string>();
    for (const team of teamsInLeague) {
      for (const memberId of team.roster.members) {
        userTeamMap.set(memberId, team.displayName);
      }
      for (const memberId of team.roster.substitutes ?? []) {
        userTeamMap.set(memberId, team.displayName);
      }
    }

    const groups = new Map<string, UserOption[]>();
    for (const user of users) {
      const teamName = userTeamMap.get(user._id) ?? t.statistics.noTeam;
      if (!groups.has(teamName)) {
        groups.set(teamName, []);
      }
      groups.get(teamName)!.push(user);
    }

    const sortedKeys = [...groups.keys()].sort((a, b) => {
      if (a === t.statistics.noTeam) {
        return 1;
      }
      if (b === t.statistics.noTeam) {
        return -1;
      }
      return a.localeCompare(b);
    });

    return sortedKeys.map((groupName) => ({
      groupName,
      users: groups.get(groupName)!,
    }));
  }, [users, teams, selectedLeague, t]);

  // Build user option JSX (shared between both selects)
  const buildUserOption = useCallback(
    (u: UserOption) => ({
      label: (
        <span style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <img
            src={
              u.avatarUrl || "https://cdn.discordapp.com/embed/avatars/0.png"
            }
            alt=""
            style={{
              width: 20,
              height: 20,
              borderRadius: "50%",
              flexShrink: 0,
            }}
          />
          <span>{u.name}</span>
          {u.majsoulName && (
            <span style={{ fontSize: "0.8em", opacity: 0.6 }}>
              ({u.majsoulName})
            </span>
          )}
        </span>
      ) as any,
      value: u._id,
      searchLabel: u.name + (u.majsoulName ? ` ${u.majsoulName}` : ""),
    }),
    []
  );

  // Toggle all players of a given team group
  const handleToggleTeamPlayers = useCallback(
    (groupPlayerIds: string[]) => {
      setSelectedPlayers(
        (() => {
          const allSelected = groupPlayerIds.every((id) =>
            selectedPlayers.includes(id)
          );
          if (allSelected) {
            return selectedPlayers.filter((id) => !groupPlayerIds.includes(id));
          }
          return [
            ...selectedPlayers,
            ...groupPlayerIds.filter((id) => !selectedPlayers.includes(id)),
          ];
        })()
      );
    },
    [selectedPlayers, setSelectedPlayers]
  );

  // Player filter options (with clickable group headers to toggle team)
  const playerOptions: GroupedOptions[] = useMemo(
    () =>
      groupedUsers.map(({ groupName, users: groupUsers }) => {
        const groupPlayerIds = groupUsers.map((u) => u._id);
        return {
          label: (
            <span
              style={{ cursor: "pointer", userSelect: "none" }}
              onMouseDown={(e: React.MouseEvent) => {
                e.preventDefault();
                e.stopPropagation();
              }}
              onClick={(e: React.MouseEvent) => {
                e.stopPropagation();
                handleToggleTeamPlayers(groupPlayerIds);
              }}
            >
              {groupName}
            </span>
          ) as any,
          options: groupUsers.map(buildUserOption),
        };
      }),
    [groupedUsers, buildUserOption, handleToggleTeamPlayers]
  );

  // Pin-player options (simple group headers, no toggle behaviour)
  const pinPlayerOptions: GroupedOptions[] = useMemo(
    () =>
      groupedUsers.map(({ groupName, users: groupUsers }) => ({
        label: groupName as any,
        options: groupUsers.map(buildUserOption),
      })),
    [groupedUsers, buildUserOption]
  );

  // Flat list of all player IDs (for "Select All")
  const allPlayerIds = useMemo(
    () => playerOptions.flatMap((g) => g.options.map((o) => o.value)),
    [playerOptions]
  );

  const allPlayersSelected = useMemo(() => {
    if (allPlayerIds.length === 0) {
      return false;
    }
    if (selectedPlayers.length !== allPlayerIds.length) {
      return false;
    }
    const selectedSet = new Set(selectedPlayers);
    return allPlayerIds.every((id) => selectedSet.has(id));
  }, [allPlayerIds, selectedPlayers]);

  const handleToggleSelectAllPlayers = useCallback(() => {
    setSelectedPlayers(allPlayersSelected ? [] : allPlayerIds);
  }, [allPlayersSelected, allPlayerIds, setSelectedPlayers]);

  return {
    playerOptions,
    pinPlayerOptions,
    allPlayersSelected,
    handleToggleSelectAllPlayers,
  };
}
