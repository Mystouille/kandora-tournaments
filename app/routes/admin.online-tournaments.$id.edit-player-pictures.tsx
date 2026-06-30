import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Avatar, Button, Card, Input, Spin, Typography, message } from "antd";
import {
  ArrowLeftOutlined,
  CameraOutlined,
  DeleteOutlined,
  UploadOutlined,
  UserOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { SquareImageCropper } from "../components/SquareImageCropper";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-player-pictures";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";
import type { PicturePair } from "../types/pictures";

const { Title, Text } = Typography;

const CROPPED_SIZE = 512;
const FULL_MAX_DIM = 1024;

interface PlayerInfo {
  _id: string;
  name: string;
  platformDisplayName: string | null;
  avatarUrl: string | null;
  leaguePicture: PicturePair | null;
}

interface TeamInfo {
  _id: string;
  displayName: string;
  roster: {
    captain: PlayerInfo | null;
    members: PlayerInfo[];
    substitutes: PlayerInfo[];
  };
  finalsRoster: {
    captain: PlayerInfo | null;
    members: PlayerInfo[];
    substitutes: PlayerInfo[];
  } | null;
}

interface LeagueDetail {
  _id: string;
  name: string;
  slug: string;
  withTeams: boolean;
  teams: TeamInfo[];
  players: PlayerInfo[];
  officialSubstitutes: PlayerInfo[];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Edit Player Pictures - TNT Paris Mahjong" }];
}

export default function EditPlayerPicturesPage() {
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [pictures, setPictures] = useState<Record<string, PicturePair | null>>(
    {}
  );
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState("");
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [cropperTarget, setCropperTarget] = useState<{
    userId: string;
    file: File;
  } | null>(null);

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
        const initial: Record<string, PicturePair | null> = {};
        const collect = (p: PlayerInfo | null | undefined) => {
          if (!p) {
            return;
          }
          if (initial[p._id] === undefined) {
            initial[p._id] = p.leaguePicture ?? null;
          }
        };
        if (data.withTeams) {
          for (const team of data.teams) {
            collect(team.roster.captain);
            team.roster.members.forEach(collect);
            team.roster.substitutes.forEach(collect);
            if (team.finalsRoster) {
              collect(team.finalsRoster.captain);
              team.finalsRoster.members.forEach(collect);
              team.finalsRoster.substitutes.forEach(collect);
            }
          }
        } else {
          data.players.forEach(collect);
        }
        data.officialSubstitutes.forEach(collect);
        setPictures(initial);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  // Build flat unique player list for display (ordered: team rosters /
  // individual players, then official substitutes).
  const allPlayers: PlayerInfo[] = useMemo(() => {
    if (!league) {
      return [];
    }
    const out: PlayerInfo[] = [];
    const seen = new Set<string>();
    const push = (p: PlayerInfo | null | undefined) => {
      if (!p || seen.has(p._id)) {
        return;
      }
      seen.add(p._id);
      out.push(p);
    };
    if (league.withTeams) {
      for (const team of league.teams) {
        push(team.roster.captain);
        team.roster.members.forEach(push);
        team.roster.substitutes.forEach(push);
        if (team.finalsRoster) {
          push(team.finalsRoster.captain);
          team.finalsRoster.members.forEach(push);
          team.finalsRoster.substitutes.forEach(push);
        }
      }
    } else {
      league.players.forEach(push);
    }
    league.officialSubstitutes.forEach(push);
    return out;
  }, [league]);

  const filteredPlayers = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) {
      return allPlayers;
    }
    return allPlayers.filter(
      (p) =>
        p.name.toLowerCase().includes(q) ||
        (p.platformDisplayName ?? "").toLowerCase().includes(q)
    );
  }, [allPlayers, search]);

  const openCropper = (userId: string, file: File) => {
    setCropperTarget({ userId, file });
  };

  const handleCropConfirm = async (pair: PicturePair) => {
    if (!cropperTarget) {
      return;
    }
    const { userId } = cropperTarget;
    setCropperTarget(null);
    setPictures((prev) => ({ ...prev, [userId]: pair }));
    await savePicture(userId, pair);
  };

  const handleRemove = async (userId: string) => {
    setPictures((prev) => ({ ...prev, [userId]: null }));
    await savePicture(userId, null);
  };

  const savePicture = async (userId: string, pair: PicturePair | null) => {
    if (!league) {
      return;
    }
    setSaving((prev) => ({ ...prev, [userId]: true }));
    try {
      const res = await fetch(`${basePath}/api/admin/league-user-picture`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          leagueId: league._id,
          userId,
          pictures: pair,
        }),
      });
      if (!res.ok) {
        throw new Error("Save failed");
      }
      message.success(pair ? tt.playerPicturesSaved : tt.playerPicturesRemoved);
    } catch {
      message.error(tt.playerPicturesSaveError);
    } finally {
      setSaving((prev) => ({ ...prev, [userId]: false }));
    }
  };

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (!league) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Text type="secondary">League not found.</Text>
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

      <Title level={3}>
        <CameraOutlined style={{ marginRight: 8 }} />
        {tt.playerPicturesEditor}
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 16 }}>
        {tt.playerPicturesMaxSize}
      </Text>

      <Input.Search
        placeholder={tt.playerPicturesSearchPlaceholder}
        allowClear
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        style={{ marginBottom: 16, maxWidth: 360 }}
      />

      <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
        {filteredPlayers.map((player) => {
          const current = pictures[player._id] ?? null;
          const avatarSrc = current?.croppedPicture ?? player.avatarUrl;
          return (
            <Card key={player._id} size="small" type="inner">
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  gap: 16,
                  flexWrap: "wrap",
                }}
              >
                <Avatar
                  src={avatarSrc ?? undefined}
                  icon={!avatarSrc ? <UserOutlined /> : undefined}
                  size={64}
                  style={{
                    flexShrink: 0,
                    border: "1px solid #d9d9d9",
                  }}
                />
                <div style={{ flex: 1, minWidth: 120 }}>
                  <Text strong style={{ fontSize: 16 }}>
                    {player.name}
                  </Text>
                  {player.platformDisplayName && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {player.platformDisplayName}
                      </Text>
                    </div>
                  )}
                  {!current && (
                    <div>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        {tt.playerPicturesNone}
                      </Text>
                    </div>
                  )}
                </div>
                <div style={{ display: "flex", gap: 8 }}>
                  <input
                    ref={(el) => {
                      fileInputRefs.current[player._id] = el;
                    }}
                    type="file"
                    accept="image/png,image/jpeg,image/webp"
                    style={{ display: "none" }}
                    onChange={(e) => {
                      const file = e.target.files?.[0];
                      if (file) {
                        openCropper(player._id, file);
                      }
                      e.target.value = "";
                    }}
                  />
                  <Button
                    icon={<UploadOutlined />}
                    loading={saving[player._id]}
                    onClick={() => fileInputRefs.current[player._id]?.click()}
                  >
                    {tt.teamPicturesUpload}
                  </Button>
                  {current && (
                    <Button
                      danger
                      icon={<DeleteOutlined />}
                      loading={saving[player._id]}
                      onClick={() => handleRemove(player._id)}
                    >
                      {tt.teamPicturesRemove}
                    </Button>
                  )}
                </div>
              </div>
            </Card>
          );
        })}
      </div>

      <SquareImageCropper
        open={!!cropperTarget}
        source={cropperTarget?.file ?? null}
        croppedSize={CROPPED_SIZE}
        fullMaxDim={FULL_MAX_DIM}
        title={tt.playerPicturesEditor}
        okText={tt.teamPicturesUpload}
        cancelText={tt.teamPicturesRemove}
        onConfirm={handleCropConfirm}
        onCancel={() => setCropperTarget(null)}
      />
    </div>
  );
}
