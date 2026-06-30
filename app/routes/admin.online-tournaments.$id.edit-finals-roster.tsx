import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Button,
  Card,
  Spin,
  Typography,
  message,
  Avatar,
  Tag,
  List,
  Checkbox,
  Alert,
} from "antd";
import {
  SaveOutlined,
  UserOutlined,
  ArrowLeftOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-finals-roster";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";

const { Title, Text } = Typography;

interface PlayerInfo {
  _id: string;
  name: string;
  platformDisplayName: string | null;
  avatarUrl: string | null;
}

interface RosterInfo {
  captain: PlayerInfo | null;
  members: PlayerInfo[];
  substitutes: PlayerInfo[];
}

interface TeamInfo {
  _id: string;
  simpleName: string;
  displayName: string;
  roster: RosterInfo;
  finalsRoster: RosterInfo | null;
}

interface LeagueDetail {
  _id: string;
  name: string;
  slug: string;
  withTeams: boolean;
  teams: TeamInfo[];
}

// Per-team state: which player IDs are selected for finals, and who is captain/sub
interface TeamFinalsState {
  captain: string;
  members: string[];
  substitutes: string[];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Edit Finals Roster - TNT Paris Mahjong" }];
}

export default function EditFinalsRosterPage() {
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  // Map of teamId -> finals roster state
  const [finalsMap, setFinalsMap] = useState<Record<string, TeamFinalsState>>(
    {}
  );

  useEffect(() => {
    if (!id) {
      return;
    }
    fetch(
      `${basePath}/api/online-tournaments/${encodeURIComponent(id)}/can-edit`
    )
      .then((res) => res.json())
      .then((data) => {
        if (!data?.canEdit) {
          navigate("/");
        }
      })
      .catch(() => navigate("/"));
  }, [id, navigate]);

  useEffect(() => {
    if (!id) {
      return;
    }
    // Fetch league detail by ID — the slug API expects a slug, so we
    // use the id directly (the API resolves by slug match from all leagues).
    // But we have an ID, not a slug. So let's first fetch the slug from
    // the leagues list, or use a different approach.
    // Actually the existing API takes a slug param. Let's fetch all leagues
    // to find the slug, or better — fetch by id via can-edit then use the
    // returned data. The simplest: fetch "/api/online-tournaments" list
    // and find ours.
    fetch(`${basePath}/api/online-tournaments`)
      .then((res) => res.json())
      .then((list: Array<{ _id: string; slug: string }>) => {
        const found = list.find((l) => l._id === id);
        if (!found) {
          setLoading(false);
          return;
        }
        return fetch(
          `${basePath}/api/online-tournaments/${encodeURIComponent(found.slug)}`
        );
      })
      .then((res) => {
        if (!res) {
          return;
        }
        return res.json();
      })
      .then((data: LeagueDetail | undefined) => {
        if (!data) {
          setLoading(false);
          return;
        }
        setLeague(data);

        // Initialize finals state from existing finalsRoster or empty
        const initial: Record<string, TeamFinalsState> = {};
        for (const team of data.teams) {
          if (team.finalsRoster) {
            initial[team._id] = {
              captain: team.finalsRoster.captain?._id ?? "",
              members: team.finalsRoster.members.map((m) => m._id),
              substitutes: team.finalsRoster.substitutes.map((s) => s._id),
            };
          } else {
            // Default: no finals roster yet
            initial[team._id] = {
              captain: team.roster.captain?._id ?? "",
              members: [],
              substitutes: [],
            };
          }
        }
        setFinalsMap(initial);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const handleTogglePlayer = (
    teamId: string,
    playerId: string,
    isSub: boolean
  ) => {
    setFinalsMap((prev) => {
      const state = prev[teamId];
      if (!state) {
        return prev;
      }
      const list = isSub ? state.substitutes : state.members;
      const isIn = list.includes(playerId);
      const newList = isIn
        ? list.filter((id) => id !== playerId)
        : [...list, playerId];

      return {
        ...prev,
        [teamId]: {
          ...state,
          [isSub ? "substitutes" : "members"]: newList,
        },
      };
    });
  };

  const handleSetCaptain = (teamId: string, playerId: string) => {
    setFinalsMap((prev) => {
      const state = prev[teamId];
      if (!state) {
        return prev;
      }
      return {
        ...prev,
        [teamId]: { ...state, captain: playerId },
      };
    });
  };

  const handleSave = async () => {
    if (!league) {
      return;
    }
    setSaving(true);
    try {
      const teamsPayload = Object.entries(finalsMap).map(([teamId, state]) => ({
        teamId,
        captain: state.captain,
        members: state.members,
        substitutes: state.substitutes,
      }));

      const res = await fetch(`${basePath}/api/admin/league-finals-roster`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league._id,
          teams: teamsPayload,
        }),
      });

      if (!res.ok) {
        throw new Error("Save failed");
      }
      message.success(tt.finalsRosterSaved);
    } catch {
      message.error(tt.finalsRosterSaveError);
    } finally {
      setSaving(false);
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!league || !league.withTeams) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Text type="secondary">League not found or not a team league.</Text>
      </div>
    );
  }

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <Link to={`/online-tournaments/${league.slug}`}>
        <Button
          size="small"
          icon={<ArrowLeftOutlined />}
          style={{ marginBottom: 12 }}
        >
          {tt.backToLeague}
        </Button>
      </Link>

      <Title level={2}>{tt.finalsRosterEditor}</Title>
      <Text type="secondary">{league.name}</Text>

      <Alert
        message={tt.finalsRosterDescription}
        type="info"
        showIcon
        style={{ margin: "16px 0" }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {league.teams.map((team) => {
          const state = finalsMap[team._id];
          if (!state) {
            return null;
          }

          const allPlayers = [
            ...team.roster.members.map((p) => ({ ...p, isSub: false })),
            ...team.roster.substitutes.map((p) => ({ ...p, isSub: true })),
          ];

          return (
            <Card
              key={team._id}
              title={team.displayName}
              size="small"
              type="inner"
            >
              <List
                size="small"
                dataSource={allPlayers}
                renderItem={(player) => {
                  const inMembers = state.members.includes(player._id);
                  const inSubs = state.substitutes.includes(player._id);
                  const isSelected = inMembers || inSubs;
                  const isCaptain = state.captain === player._id;

                  return (
                    <List.Item
                      actions={[
                        <Checkbox
                          key="member"
                          checked={inMembers}
                          onChange={() =>
                            handleTogglePlayer(team._id, player._id, false)
                          }
                          disabled={inSubs}
                        >
                          Member
                        </Checkbox>,
                        <Checkbox
                          key="sub"
                          checked={inSubs}
                          onChange={() =>
                            handleTogglePlayer(team._id, player._id, true)
                          }
                          disabled={inMembers}
                        >
                          Sub
                        </Checkbox>,
                        <Checkbox
                          key="captain"
                          checked={isCaptain}
                          onChange={() =>
                            handleSetCaptain(team._id, player._id)
                          }
                          disabled={!isSelected}
                        >
                          Captain
                        </Checkbox>,
                      ]}
                    >
                      <List.Item.Meta
                        avatar={
                          <Avatar
                            src={player.avatarUrl}
                            icon={
                              !player.avatarUrl ? <UserOutlined /> : undefined
                            }
                            size="small"
                          />
                        }
                        title={
                          <span>
                            {player.name}
                            {player.platformDisplayName && (
                              <Text
                                type="secondary"
                                style={{ marginLeft: 8, fontSize: 12 }}
                              >
                                {player.platformDisplayName}
                              </Text>
                            )}
                            {player.isSub && (
                              <Tag style={{ marginLeft: 8 }} color="orange">
                                {t.onlineTournaments.substitute}
                              </Tag>
                            )}
                          </span>
                        }
                      />
                    </List.Item>
                  );
                }}
              />
            </Card>
          );
        })}
      </div>

      <div style={{ marginTop: 24, textAlign: "right" }}>
        <Button
          type="primary"
          icon={<SaveOutlined />}
          loading={saving}
          onClick={handleSave}
          size="large"
        >
          {tt.submitOnly}
        </Button>
      </div>
    </div>
  );
}
