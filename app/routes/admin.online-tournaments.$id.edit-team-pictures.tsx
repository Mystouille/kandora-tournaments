import { useEffect, useRef, useState } from "react";
import { Link, useParams } from "react-router";
import { Button, Card, Spin, Typography, message } from "antd";
import {
  ArrowLeftOutlined,
  AimOutlined,
  CameraOutlined,
  DeleteOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { TeamLogo } from "../components/TeamLogo";
import { SquareImageCropper } from "../components/SquareImageCropper";
import { TeamPictureCenterModal } from "../components/TeamPictureCenterModal";
import { getDefaultTeamColor } from "../utils/teamColors";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-team-pictures";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";
import type { PicturePair, TeamPicturePair } from "../types/pictures";

const { Title, Text } = Typography;

const CROPPED_SIZE = 256;
const FULL_MAX_DIM = 1024;

interface TeamInfo {
  _id: string;
  simpleName: string;
  displayName: string;
  color?: string | null;
  pictures: TeamPicturePair | null;
}

interface LeagueDetail {
  _id: string;
  name: string;
  slug: string;
  withTeams: boolean;
  teams: TeamInfo[];
}

export async function loader({ request, params }: Route.LoaderArgs) {
  await requireLeagueAdminOrRedirect(request, params.id!);
  return null;
}

export function meta() {
  return [{ title: "Edit Team Pictures - TNT Paris Mahjong" }];
}

export default function EditTeamPicturesPage() {
  const { t } = useLocale();
  const tt = t.onlineTournaments.admin;
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [pictures, setPictures] = useState<
    Record<string, TeamPicturePair | null>
  >({});
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [cropperTarget, setCropperTarget] = useState<{
    teamId: string;
    file: File;
  } | null>(null);
  const [centerTarget, setCenterTarget] = useState<string | null>(null);

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
        const initial: Record<string, TeamPicturePair | null> = {};
        for (const team of data.teams) {
          initial[team._id] = team.pictures ?? null;
        }
        setPictures(initial);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, [id]);

  const openCropper = (teamId: string, file: File) => {
    setCropperTarget({ teamId, file });
  };

  const handleCropConfirm = async (pair: PicturePair) => {
    if (!cropperTarget) {
      return;
    }
    const { teamId } = cropperTarget;
    setCropperTarget(null);
    await savePicture(teamId, { pictures: pair });
  };

  const handleRemove = async (teamId: string) => {
    await savePicture(teamId, { pictures: null });
  };

  const savePicture = async (
    teamId: string,
    update:
      | { pictures: PicturePair | null }
      | { fullPicture: string; summaryCenterY: number }
  ): Promise<boolean> => {
    const replacing = "pictures" in update;
    setSaving((prev) => ({ ...prev, [teamId]: true }));
    try {
      const res = await fetch(`${basePath}/api/admin/league-team-picture`, {
        method: replacing ? "PUT" : "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, ...update }),
      });
      if (!res.ok) {
        if (res.status === 409 && !replacing) {
          message.error(tt.teamPicturesCenterChanged);
          return false;
        }
        throw new Error("Save failed");
      }
      const result: { success?: boolean; pictures?: TeamPicturePair | null } =
        await res.json();
      if (result.success !== true || result.pictures === undefined) {
        throw new Error("The server did not return the stored picture");
      }
      const stored = result.pictures;
      setPictures((prev) => ({ ...prev, [teamId]: stored }));
      message.success(
        replacing
          ? update.pictures
            ? tt.teamPicturesSaved
            : tt.teamPicturesRemoved
          : tt.teamPicturesCenterSaved
      );
      return true;
    } catch (error) {
      console.error("[team pictures] Save failed", error);
      message.error(tt.teamPicturesSaveError);
      return false;
    } finally {
      setSaving((prev) => ({ ...prev, [teamId]: false }));
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

  const centerTeam = league.teams.find((team) => team._id === centerTarget);
  const centerPicture = centerTeam ? pictures[centerTeam._id] : null;

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <Link to={`/admin/online-tournaments/${id}`}>
        <Button
          size="small"
          icon={<ArrowLeftOutlined />}
          style={{ marginBottom: 12 }}
        >
          {t.admin.manageTournament}
        </Button>
      </Link>

      <Title level={3}>
        <CameraOutlined style={{ marginRight: 8 }} />
        {tt.teamPicturesEditor}
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
        {tt.teamPicturesMaxSize}
      </Text>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {league.teams.map((team) => (
          <Card
            key={team._id}
            size="small"
            type="inner"
            data-team-picture-id={team._id}
          >
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: 16,
                flexWrap: "wrap",
              }}
            >
              <TeamLogo
                pictures={pictures[team._id]}
                icon={<CameraOutlined />}
                size={64}
                style={{
                  flexShrink: 0,
                  border: "1px solid #d9d9d9",
                }}
              />
              <div style={{ flex: 1, minWidth: 120 }}>
                <Text strong style={{ fontSize: 16 }}>
                  {team.displayName}
                </Text>
                {!pictures[team._id] && (
                  <div>
                    <Text type="secondary" style={{ fontSize: 12 }}>
                      {tt.teamPicturesNone}
                    </Text>
                  </div>
                )}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                <input
                  ref={(el) => {
                    fileInputRefs.current[team._id] = el;
                  }}
                  type="file"
                  accept="image/png,image/jpeg,image/webp"
                  style={{ display: "none" }}
                  onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) {
                      openCropper(team._id, file);
                    }
                    e.target.value = "";
                  }}
                />
                <Button
                  icon={<UploadOutlined />}
                  loading={saving[team._id]}
                  onClick={() => fileInputRefs.current[team._id]?.click()}
                >
                  {tt.teamPicturesUpload}
                </Button>
                <Button
                  icon={<AimOutlined aria-hidden />}
                  aria-label={tt.teamPicturesCenter}
                  disabled={!pictures[team._id] || saving[team._id]}
                  onClick={() => setCenterTarget(team._id)}
                >
                  {tt.teamPicturesCenter}
                </Button>
                {pictures[team._id] && (
                  <Button
                    danger
                    icon={<DeleteOutlined />}
                    loading={saving[team._id]}
                    onClick={() => handleRemove(team._id)}
                  >
                    {tt.teamPicturesRemove}
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      {centerTeam && centerPicture && (
        <TeamPictureCenterModal
          key={`${centerTeam._id}:${centerPicture.fullPicture}`}
          pictures={centerPicture}
          teamName={centerTeam.displayName}
          teamColor={
            centerTeam.color ??
            getDefaultTeamColor(
              league.teams
                .map((team) => team._id)
                .sort()
                .indexOf(centerTeam._id)
            )
          }
          saving={!!saving[centerTeam._id]}
          onCancel={() => setCenterTarget(null)}
          onConfirm={async (summaryCenterY) => {
            const saved = await savePicture(centerTeam._id, {
              fullPicture: centerPicture.fullPicture,
              summaryCenterY,
            });
            if (saved) {
              setCenterTarget(null);
            }
          }}
        />
      )}

      <SquareImageCropper
        open={!!cropperTarget}
        source={cropperTarget?.file ?? null}
        croppedSize={CROPPED_SIZE}
        fullMaxDim={FULL_MAX_DIM}
        title={tt.teamPicturesEditor}
        okText={tt.teamPicturesUpload}
        cancelText={tt.teamPicturesRemove}
        onConfirm={handleCropConfirm}
        onCancel={() => setCropperTarget(null)}
      />
    </div>
  );
}
