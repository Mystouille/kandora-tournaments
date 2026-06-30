import { useEffect, useMemo, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import {
  Alert,
  Avatar,
  Button,
  Card,
  Checkbox,
  Form,
  Input,
  List,
  Modal,
  Select,
  Spin,
  Switch,
  Tag,
  Typography,
  message,
} from "antd";
import {
  ArrowLeftOutlined,
  DeleteOutlined,
  PlusOutlined,
  SaveOutlined,
  UserAddOutlined,
  UserOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-roster";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";

const { Title, Text } = Typography;

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Edit Roster - TNT Paris Mahjong" }];
}

interface UserInfo {
  _id: string;
  name: string;
  avatarUrl: string | null;
  platformId: string | null;
  platformDisplayName: string | null;
}

interface RosterPlayer {
  userId: string;
  isSubstitute: boolean;
  isCaptain: boolean;
}

interface RosterTeam {
  _id: string | null; // null for newly created teams
  simpleName: string;
  displayName: string;
  players: RosterPlayer[];
}

interface RosterData {
  leagueId: string;
  leagueName: string;
  platform: string;
  isTeamMode: boolean;
  hasTournamentId: boolean;
  teams: Array<{
    _id: string;
    simpleName: string;
    displayName: string;
    players: RosterPlayer[];
  }>;
  users: UserInfo[];
}

let nextTempTeamId = 1;
const tempTeamId = () => `__new_team_${nextTempTeamId++}`;

export default function EditRosterPage() {
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();

  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [data, setData] = useState<RosterData | null>(null);
  const [teams, setTeams] = useState<RosterTeam[]>([]);
  const [usersById, setUsersById] = useState<Record<string, UserInfo>>({});
  const [platformIdEdits, setPlatformIdEdits] = useState<
    Record<string, string>
  >({});
  const [syncToPlatform, setSyncToPlatform] = useState(true);

  // Add-player modal state
  const [addModalTeamId, setAddModalTeamId] = useState<string | null>(null);
  const [addPlatformId, setAddPlatformId] = useState("");
  const [addNameOverride, setAddNameOverride] = useState("");
  const [addUnlinkedName, setAddUnlinkedName] = useState("");
  const [addBusy, setAddBusy] = useState(false);

  // New team modal state
  const [newTeamModalOpen, setNewTeamModalOpen] = useState(false);
  const [newTeamName, setNewTeamName] = useState("");

  useEffect(() => {
    if (!id) {
      return;
    }
    fetch(
      `${basePath}/api/online-tournaments/${encodeURIComponent(id)}/can-edit`
    )
      .then((res) => res.json())
      .then((result) => {
        if (!result?.canEdit) {
          navigate("/");
        }
      })
      .catch(() => navigate("/"));
  }, [id, navigate]);

  useEffect(() => {
    if (!id) {
      return;
    }
    setLoading(true);
    fetch(
      `${basePath}/api/admin/league-roster?leagueId=${encodeURIComponent(id)}`
    )
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to load");
        }
        return res.json();
      })
      .then((d: RosterData) => {
        setData(d);
        setTeams(
          d.teams.map((t) => ({
            _id: t._id,
            simpleName: t.simpleName,
            displayName: t.displayName,
            players: t.players,
          }))
        );
        const map: Record<string, UserInfo> = {};
        for (const u of d.users) {
          map[u._id] = u;
        }
        setUsersById(map);
        setPlatformIdEdits({});
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  async function reloadRoster() {
    if (!id) {
      return;
    }
    const res = await fetch(
      `${basePath}/api/admin/league-roster?leagueId=${encodeURIComponent(id)}`
    );
    if (!res.ok) {
      return;
    }
    const d: RosterData = await res.json();
    setData(d);
    setTeams(
      d.teams.map((t) => ({
        _id: t._id,
        simpleName: t.simpleName,
        displayName: t.displayName,
        players: t.players,
      }))
    );
    const map: Record<string, UserInfo> = {};
    for (const u of d.users) {
      map[u._id] = u;
    }
    setUsersById(map);
    setPlatformIdEdits({});
  }

  const teamByUserId = useMemo(() => {
    const map = new Map<string, string>(); // userId -> team key (_id or temp)
    for (const team of teams) {
      const teamKey = team._id ?? team.simpleName;
      for (const p of team.players) {
        map.set(p.userId, teamKey);
      }
    }
    return map;
  }, [teams]);

  function updateTeam(teamKey: string, updater: (t: RosterTeam) => RosterTeam) {
    setTeams((prev) =>
      prev.map((t) => ((t._id ?? t.simpleName) === teamKey ? updater(t) : t))
    );
  }

  function removePlayer(teamKey: string, userId: string) {
    updateTeam(teamKey, (t) => ({
      ...t,
      players: t.players.filter((p) => p.userId !== userId),
    }));
  }

  function togglePlayerSub(teamKey: string, userId: string) {
    updateTeam(teamKey, (t) => ({
      ...t,
      players: t.players.map((p) =>
        p.userId === userId ? { ...p, isSubstitute: !p.isSubstitute } : p
      ),
    }));
  }

  function setPlayerCaptain(teamKey: string, userId: string) {
    updateTeam(teamKey, (t) => ({
      ...t,
      players: t.players.map((p) => ({
        ...p,
        isCaptain: p.userId === userId,
      })),
    }));
  }

  function movePlayerToTeam(
    fromTeamKey: string,
    toTeamKey: string,
    userId: string
  ) {
    if (fromTeamKey === toTeamKey) {
      return;
    }
    setTeams((prev) => {
      let movedPlayer: RosterPlayer | null = null;
      const stripped = prev.map((t) => {
        const key = t._id ?? t.simpleName;
        if (key !== fromTeamKey) {
          return t;
        }
        const found = t.players.find((p) => p.userId === userId);
        if (found) {
          movedPlayer = { ...found, isCaptain: false };
        }
        return {
          ...t,
          players: t.players.filter((p) => p.userId !== userId),
        };
      });
      if (!movedPlayer) {
        return prev;
      }
      return stripped.map((t) => {
        const key = t._id ?? t.simpleName;
        if (key !== toTeamKey) {
          return t;
        }
        // Avoid duplicate
        if (t.players.some((p) => p.userId === userId)) {
          return t;
        }
        return { ...t, players: [...t.players, movedPlayer!] };
      });
    });
  }

  function deleteTeam(teamKey: string) {
    setTeams((prev) => prev.filter((t) => (t._id ?? t.simpleName) !== teamKey));
  }

  async function handleAddPlayer() {
    if (!addModalTeamId || !data) {
      return;
    }
    setAddBusy(true);
    try {
      let newUser: UserInfo | null = null;
      if (addPlatformId.trim()) {
        const res = await fetch(`${basePath}/api/admin/league-roster`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "find-or-create-user",
            leagueId: data.leagueId,
            platformId: addPlatformId.trim(),
            nameOverride: addNameOverride.trim() || undefined,
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          message.error(json.error ?? tt.rosterPlatformLookupFailed);
          setAddBusy(false);
          return;
        }
        newUser = json.user;
      } else if (addUnlinkedName.trim()) {
        const res = await fetch(`${basePath}/api/admin/league-roster`, {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            intent: "create-unlinked-user",
            leagueId: data.leagueId,
            name: addUnlinkedName.trim(),
          }),
        });
        const json = await res.json();
        if (!res.ok) {
          message.error(json.error ?? tt.rosterAddPlayerFailed);
          setAddBusy(false);
          return;
        }
        newUser = json.user;
      } else {
        message.warning(tt.rosterAddPlayerNeedInput);
        setAddBusy(false);
        return;
      }

      if (!newUser) {
        setAddBusy(false);
        return;
      }
      const finalUser = newUser;

      // Add to map and to team
      setUsersById((prev) => ({ ...prev, [finalUser._id]: finalUser }));

      const alreadyInTeam = teamByUserId.get(finalUser._id);
      if (alreadyInTeam && alreadyInTeam !== addModalTeamId) {
        message.warning(tt.rosterPlayerAlreadyInOtherTeam);
        setAddBusy(false);
        return;
      }

      updateTeam(addModalTeamId, (t) => {
        if (t.players.some((p) => p.userId === finalUser._id)) {
          return t;
        }
        return {
          ...t,
          players: [
            ...t.players,
            {
              userId: finalUser._id,
              isSubstitute: false,
              isCaptain: t.players.length === 0,
            },
          ],
        };
      });

      setAddModalTeamId(null);
      setAddPlatformId("");
      setAddNameOverride("");
      setAddUnlinkedName("");
    } catch (err) {
      console.error(err);
      message.error(tt.rosterAddPlayerFailed);
    } finally {
      setAddBusy(false);
    }
  }

  function handleCreateTeam() {
    const name = newTeamName.trim();
    if (!name) {
      message.warning(tt.rosterTeamNameRequired);
      return;
    }
    if (
      teams.some(
        (t) =>
          t.simpleName.toLowerCase() === name.toLowerCase() ||
          t.displayName.toLowerCase() === name.toLowerCase()
      )
    ) {
      message.warning(tt.rosterTeamNameDuplicate);
      return;
    }
    setTeams((prev) => [
      ...prev,
      {
        _id: tempTeamId(),
        simpleName: name,
        displayName: name,
        players: [],
      },
    ]);
    setNewTeamName("");
    setNewTeamModalOpen(false);
  }

  async function handleSave() {
    if (!data) {
      return;
    }
    setSaving(true);
    try {
      // Validate captain consistency: every team with players must have one
      for (const team of teams) {
        if (team.players.length > 0 && !team.players.some((p) => p.isCaptain)) {
          message.error(`${tt.rosterTeamMissingCaptain}: ${team.displayName}`);
          setSaving(false);
          return;
        }
      }

      // Filter teams to send: drop teams whose _id starts with the temp prefix
      // and reassign null teamId to indicate "create new".
      const teamsPayload = teams.map((t) => ({
        teamId: t._id && !t._id.startsWith("__new_team_") ? t._id : null,
        simpleName: t.simpleName,
        displayName: t.displayName,
        players: t.players,
      }));

      const res = await fetch(`${basePath}/api/admin/league-roster`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: data.leagueId,
          teams: teamsPayload,
          platformIdUpdates: platformIdEdits,
          syncToPlatform,
        }),
      });
      const json = await res.json();
      if (!res.ok) {
        message.error(json.error ?? tt.rosterSaveError);
        setSaving(false);
        return;
      }

      if (json.platformSync?.attempted && !json.platformSync.success) {
        message.warning(
          `${tt.rosterPlatformSyncFailed}: ${json.platformSync.error ?? ""}`
        );
      } else {
        message.success(tt.rosterSaved);
      }

      // Refresh page state so newly-created teams pick up real DB IDs.
      await reloadRoster();
    } catch (err) {
      console.error(err);
      message.error(tt.rosterSaveError);
    } finally {
      setSaving(false);
    }
  }

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!data) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Text type="secondary">{tt.rosterLoadError}</Text>
      </div>
    );
  }

  const teamsForMoveSelect = teams.map((t) => ({
    value: t._id ?? t.simpleName,
    label: t.displayName,
  }));

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <Link to={`/online-tournaments`}>
        <Button
          size="small"
          icon={<ArrowLeftOutlined />}
          style={{ marginBottom: 12 }}
        >
          {tt.backToLeague}
        </Button>
      </Link>

      <Title level={2}>{tt.rosterEditor}</Title>
      <Text type="secondary">{data.leagueName}</Text>

      <Alert
        message={tt.rosterEditorDescription}
        type="info"
        showIcon
        style={{ margin: "16px 0" }}
      />

      {data.hasTournamentId && (
        <div style={{ marginBottom: 16 }}>
          <Switch
            checked={syncToPlatform}
            onChange={setSyncToPlatform}
            id="sync-to-platform"
          />
          <label htmlFor="sync-to-platform" style={{ marginLeft: 8 }}>
            {tt.rosterSyncToPlatform}
          </label>
        </div>
      )}

      {data.isTeamMode && (
        <div style={{ marginBottom: 16, textAlign: "right" }}>
          <Button
            type="dashed"
            icon={<TeamOutlined />}
            onClick={() => setNewTeamModalOpen(true)}
          >
            {tt.rosterCreateTeam}
          </Button>
        </div>
      )}

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {teams.map((team) => {
          const teamKey = team._id ?? team.simpleName;
          return (
            <Card
              key={teamKey}
              size="small"
              type="inner"
              title={
                <Input
                  value={team.displayName}
                  onChange={(e) =>
                    updateTeam(teamKey, (t) => ({
                      ...t,
                      displayName: e.target.value,
                      simpleName: e.target.value,
                    }))
                  }
                  style={{ maxWidth: 280 }}
                  size="small"
                />
              }
              extra={
                <div style={{ display: "flex", gap: 8 }}>
                  <Button
                    size="small"
                    icon={<UserAddOutlined />}
                    onClick={() => setAddModalTeamId(teamKey)}
                  >
                    {tt.rosterAddPlayer}
                  </Button>
                  <Button
                    danger
                    size="small"
                    icon={<DeleteOutlined />}
                    onClick={() => deleteTeam(teamKey)}
                  >
                    {tt.rosterDeleteTeam}
                  </Button>
                </div>
              }
            >
              <List
                size="small"
                dataSource={team.players}
                locale={{ emptyText: tt.rosterNoPlayers }}
                renderItem={(p: RosterPlayer) => {
                  const u = usersById[p.userId];
                  if (!u) {
                    return null;
                  }
                  const platformIdValue =
                    platformIdEdits[u._id] ?? u.platformId ?? "";
                  const hasPlatformId = !!u.platformId;
                  return (
                    <List.Item>
                      <div
                        style={{
                          display: "flex",
                          alignItems: "center",
                          gap: 12,
                          width: "100%",
                          flexWrap: "wrap",
                        }}
                      >
                        <Avatar
                          src={u.avatarUrl}
                          icon={!u.avatarUrl ? <UserOutlined /> : undefined}
                          size="small"
                        />
                        <div style={{ flex: "1 1 200px", minWidth: 0 }}>
                          <div
                            style={{
                              fontWeight: 500,
                              overflow: "hidden",
                              textOverflow: "ellipsis",
                              whiteSpace: "nowrap",
                            }}
                          >
                            {u.name}
                          </div>
                          {u.platformDisplayName && (
                            <Text type="secondary" style={{ fontSize: 12 }}>
                              {u.platformDisplayName}
                            </Text>
                          )}
                        </div>
                        <Input
                          size="small"
                          placeholder={tt.rosterPlatformIdPlaceholder}
                          value={platformIdValue}
                          status={
                            hasPlatformId || platformIdEdits[u._id]
                              ? undefined
                              : "warning"
                          }
                          onChange={(e) =>
                            setPlatformIdEdits((prev) => ({
                              ...prev,
                              [u._id]: e.target.value,
                            }))
                          }
                          style={{ width: 140 }}
                        />
                        <Checkbox
                          checked={p.isSubstitute}
                          onChange={() => togglePlayerSub(teamKey, p.userId)}
                        >
                          {t.onlineTournaments.substitute}
                        </Checkbox>
                        <Checkbox
                          checked={p.isCaptain}
                          onChange={() => setPlayerCaptain(teamKey, p.userId)}
                        >
                          {tt.rosterCaptain}
                        </Checkbox>
                        {teamsForMoveSelect.length > 1 && (
                          <Select
                            size="small"
                            value={teamKey}
                            options={teamsForMoveSelect}
                            onChange={(toKey) =>
                              movePlayerToTeam(teamKey, toKey, p.userId)
                            }
                            style={{ width: 140 }}
                          />
                        )}
                        <Button
                          danger
                          size="small"
                          icon={<DeleteOutlined />}
                          onClick={() => removePlayer(teamKey, p.userId)}
                        />
                      </div>
                    </List.Item>
                  );
                }}
              />
              {!hasPlayerWithPlatformId(team, usersById, platformIdEdits) &&
                team.players.length > 0 && (
                  <Tag color="warning" style={{ marginTop: 8 }}>
                    {tt.rosterTeamNoPlatformId}
                  </Tag>
                )}
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

      <Modal
        open={addModalTeamId !== null}
        title={tt.rosterAddPlayer}
        onCancel={() => {
          setAddModalTeamId(null);
          setAddPlatformId("");
          setAddNameOverride("");
          setAddUnlinkedName("");
        }}
        onOk={handleAddPlayer}
        confirmLoading={addBusy}
        okText={tt.rosterAddPlayer}
        okButtonProps={{ icon: <PlusOutlined /> }}
      >
        <Form layout="vertical">
          <Form.Item
            label={tt.rosterPlatformIdLabel}
            help={tt.rosterPlatformIdHelp}
          >
            <Input
              value={addPlatformId}
              onChange={(e) => setAddPlatformId(e.target.value)}
              placeholder={tt.rosterPlatformIdPlaceholder}
              autoFocus
            />
          </Form.Item>
          <Form.Item
            label={tt.rosterNameOverrideLabel}
            help={tt.rosterNameOverrideHelp}
          >
            <Input
              value={addNameOverride}
              onChange={(e) => setAddNameOverride(e.target.value)}
              placeholder={tt.rosterNameOverridePlaceholder}
              disabled={!addPlatformId.trim()}
            />
          </Form.Item>
          <Form.Item
            label={tt.rosterUnlinkedNameLabel}
            help={tt.rosterUnlinkedNameHelp}
          >
            <Input
              value={addUnlinkedName}
              onChange={(e) => setAddUnlinkedName(e.target.value)}
              placeholder={tt.rosterUnlinkedNamePlaceholder}
              disabled={!!addPlatformId.trim()}
            />
          </Form.Item>
        </Form>
      </Modal>

      <Modal
        open={newTeamModalOpen}
        title={tt.rosterCreateTeam}
        onCancel={() => {
          setNewTeamModalOpen(false);
          setNewTeamName("");
        }}
        onOk={handleCreateTeam}
        okText={tt.rosterCreateTeam}
        okButtonProps={{ icon: <PlusOutlined /> }}
      >
        <Form layout="vertical">
          <Form.Item label={tt.rosterTeamNameLabel} required>
            <Input
              value={newTeamName}
              onChange={(e) => setNewTeamName(e.target.value)}
              placeholder={tt.rosterTeamNamePlaceholder}
              autoFocus
            />
          </Form.Item>
        </Form>
      </Modal>
    </div>
  );
}

function hasPlayerWithPlatformId(
  team: RosterTeam,
  usersById: Record<string, UserInfo>,
  platformIdEdits: Record<string, string>
): boolean {
  for (const p of team.players) {
    const u = usersById[p.userId];
    if (!u) {
      continue;
    }
    if (u.platformId || platformIdEdits[u._id]?.trim()) {
      return true;
    }
  }
  return false;
}
