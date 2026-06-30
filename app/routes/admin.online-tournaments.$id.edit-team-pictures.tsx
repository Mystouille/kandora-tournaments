import { useEffect, useRef, useState } from "react";
import { Link, useNavigate, useParams } from "react-router";
import { Button, Card, Spin, Typography, message } from "antd";
import {
  ArrowLeftOutlined,
  CameraOutlined,
  DeleteOutlined,
  UploadOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { TeamLogo } from "../components/TeamLogo";
import { SquareImageCropper } from "../components/SquareImageCropper";
import { basePath } from "../utils/basePath";
import type { Route } from "./+types/admin.online-tournaments.$id.edit-team-pictures";
import { requireLeagueAdminOrRedirect } from "../utils/league-permissions.server";
import type { PicturePair } from "../types/pictures";

const { Title, Text } = Typography;

const CROPPED_SIZE = 256;
const FULL_MAX_DIM = 1024;

interface TeamInfo {
  _id: string;
  simpleName: string;
  displayName: string;
  pictures: PicturePair | null;
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
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [loading, setLoading] = useState(true);
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [pictures, setPictures] = useState<Record<string, PicturePair | null>>(
    {}
  );
  const [saving, setSaving] = useState<Record<string, boolean>>({});
  const fileInputRefs = useRef<Record<string, HTMLInputElement | null>>({});
  const [cropperTarget, setCropperTarget] = useState<{
    teamId: string;
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
    setPictures((prev) => ({ ...prev, [teamId]: pair }));
    await savePicture(teamId, pair);
  };

  const handleRemove = async (teamId: string) => {
    setPictures((prev) => ({ ...prev, [teamId]: null }));
    await savePicture(teamId, null);
  };

  const savePicture = async (teamId: string, pair: PicturePair | null) => {
    setSaving((prev) => ({ ...prev, [teamId]: true }));
    try {
      const res = await fetch(`${basePath}/api/admin/league-team-picture`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ teamId, pictures: pair }),
      });
      if (!res.ok) {
        throw new Error("Save failed");
      }
      message.success(pair ? tt.teamPicturesSaved : tt.teamPicturesRemoved);
    } catch {
      message.error(tt.teamPicturesSaveError);
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
        {tt.teamPicturesEditor}
      </Title>
      <Text type="secondary" style={{ display: "block", marginBottom: 24 }}>
        {tt.teamPicturesMaxSize}
      </Text>

      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {league.teams.map((team) => (
          <Card key={team._id} size="small" type="inner">
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
              <div style={{ display: "flex", gap: 8 }}>
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
