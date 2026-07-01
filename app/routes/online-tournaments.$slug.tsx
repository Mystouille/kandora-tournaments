import { useEffect, useState } from "react";
import { Link, useParams } from "react-router";
import {
  Typography,
  Tabs,
  Button,
  Spin,
  Descriptions,
  List,
  Tag,
  Card,
  Result,
  Modal,
  message,
} from "antd";
import {
  CameraOutlined,
  CloudUploadOutlined,
  EditOutlined,
  FileTextOutlined,
  ImportOutlined,
  InfoCircleOutlined,
  TrophyOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import { ArticleContent } from "../components/ArticleContent";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerAvatar } from "../components/PlayerAvatar";

const { Title, Text } = Typography;

interface PlayerInfo {
  _id: string;
  name: string;
  platformDisplayName: string | null;
  avatarUrl: string | null;
  leaguePicture: import("../types/pictures").PicturePair | null;
}

interface TeamInfo {
  _id: string;
  simpleName: string;
  displayName: string;
  pictures: import("../types/pictures").PicturePair | null;
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
  startTime: string;
  endTime: string;
  rulesConfig: {
    gameRules: string;
    isTeamMode: boolean;
  };
  leagueTypeConfigName: string | null;
  platformConfig: {
    platformName: string;
    tournamentId?: string;
  };
  phaseCutoffTimes: string[];
  presentation: { fr: string; en: string };
  gameCount: number;
  playerCount: number;
  withTeams: boolean;
  teams: TeamInfo[];
  players: PlayerInfo[];
  officialSubstitutes: PlayerInfo[];
}

export function meta() {
  return [{ title: "League - TNT Paris Mahjong" }];
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

export default function LeagueDetailPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t, locale } = useLocale();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [canEdit, setCanEdit] = useState(false);
  const [savingRcTables, setSavingRcTables] = useState(false);

  useEffect(() => {
    if (!slug) {
      return;
    }
    setLoading(true);
    setError(false);
    fetch(`${basePath}/api/online-tournaments/${slug}`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Not found");
        }
        return res.json();
      })
      .then((data) => {
        setLeague(data);
        setLoading(false);
      })
      .catch(() => {
        setError(true);
        setLoading(false);
      });
  }, [slug]);

  useEffect(() => {
    const id = league?._id;
    if (!id) {
      setCanEdit(false);
      return;
    }
    let cancelled = false;
    const checkCanEdit = () => {
      fetch(
        `${basePath}/api/online-tournaments/${encodeURIComponent(id)}/can-edit`
      )
        .then((res) => (res.ok ? res.json() : null))
        .then((result) => {
          if (!cancelled) {
            setCanEdit(!!result?.canEdit);
          }
        })
        .catch(() => {
          if (!cancelled) {
            setCanEdit(false);
          }
        });
    };
    checkCanEdit();
    window.addEventListener("auth-changed", checkCanEdit);
    return () => {
      cancelled = true;
      window.removeEventListener("auth-changed", checkCanEdit);
    };
  }, [league?._id]);

  if (loading) {
    return (
      <div style={{ textAlign: "center", padding: 96 }}>
        <Spin size="large" />
      </div>
    );
  }

  if (error || !league) {
    return (
      <Result
        status="404"
        title="404"
        subTitle={t.onlineTournaments.leagueNotFound}
        extra={
          <Link to="/">
            <Button type="primary">{t.onlineTournaments.backToList}</Button>
          </Link>
        }
      />
    );
  }

  const withTeams = league.withTeams ?? false;

  const presentationHtml =
    (locale === "fr"
      ? league.presentation?.fr
      : league.presentation?.en || league.presentation?.fr) || "";

  const presentationTab = (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 16, textAlign: "right" }}>
          <Link
            to={`/admin/online-tournaments/${league._id}/edit-presentation`}
          >
            <Button type="primary" icon={<EditOutlined />}>
              {t.onlineTournaments.admin.editPresentation}
            </Button>
          </Link>
        </div>
      )}
      {presentationHtml ? (
        <ArticleContent html={presentationHtml} />
      ) : (
        <Text type="secondary">{t.onlineTournaments.admin.noPresentation}</Text>
      )}
    </div>
  );

  const rulesTab = (
    <div style={{ padding: 16 }}>
      <Descriptions column={1} bordered size="small">
        <Descriptions.Item label={t.onlineTournaments.startDate}>
          {formatDate(league.startTime, locale)}
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.endDate}>
          {formatDate(league.endTime, locale)}
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.platform}>
          <Tag>{league.platformConfig?.platformName ?? "—"}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.format}>
          <Tag>{league.leagueTypeConfigName ?? "—"}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.gameRules}>
          <Tag>{league.rulesConfig?.gameRules ?? "—"}</Tag>
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.mode}>
          {withTeams
            ? t.onlineTournaments.teamMode
            : t.onlineTournaments.individualMode}
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.playerCount}>
          {league.playerCount}
        </Descriptions.Item>
        <Descriptions.Item label={t.onlineTournaments.gameCount}>
          {league.gameCount}
        </Descriptions.Item>
      </Descriptions>
    </div>
  );

  const isRiichiCity = league.platformConfig?.platformName === "RIICHICITY";

  const handleSaveRcTables = () => {
    if (!league._id) {
      return;
    }
    Modal.confirm({
      title: t.onlineTournaments.admin.saveRcTablesConfirmTitle,
      content: t.onlineTournaments.admin.saveRcTablesConfirmBody,
      okText: t.onlineTournaments.admin.saveRcTables,
      cancelText: t.common.cancel,
      onOk: async () => {
        setSavingRcTables(true);
        try {
          const res = await fetch(
            `${basePath}/api/admin/league-save-rc-tables`,
            {
              method: "POST",
              headers: { "Content-Type": "application/json" },
              body: JSON.stringify({ leagueId: league._id }),
            }
          );
          const data = await res.json().catch(() => ({}));
          if (!res.ok) {
            const errMsg =
              (data && typeof data.error === "string" && data.error) ||
              t.onlineTournaments.admin.saveRcTablesError;
            message.error(errMsg);
            return;
          }
          const rounds = Number(data?.totalRoundsSaved ?? 0);
          const tables = Number(data?.totalTablesSaved ?? 0);
          const stages = Array.isArray(data?.stagesProcessed)
            ? data.stagesProcessed.length
            : 0;
          if (rounds === 0) {
            message.info(t.onlineTournaments.admin.saveRcTablesNoStages);
            return;
          }
          message.success(
            t.onlineTournaments.admin.saveRcTablesSuccess
              .replace("{rounds}", String(rounds))
              .replace("{stages}", String(stages))
              .replace("{tables}", String(tables))
          );
        } catch {
          message.error(t.onlineTournaments.admin.saveRcTablesError);
        } finally {
          setSavingRcTables(false);
        }
      },
    });
  };

  const playerListTab = (
    <div>
      {canEdit && (
        <div
          style={{
            marginBottom: 16,
            textAlign: "right",
            display: "flex",
            gap: 8,
            justifyContent: "flex-end",
          }}
        >
          <Link to={`/admin/online-tournaments/${league._id}/import-teams`}>
            <Button type="primary" icon={<ImportOutlined />}>
              {t.onlineTournaments.admin.importRoster}
            </Button>
          </Link>
          <Link to={`/admin/online-tournaments/${league._id}/edit-roster`}>
            <Button icon={<EditOutlined />}>
              {t.onlineTournaments.admin.editRoster}
            </Button>
          </Link>
          {withTeams && (
            <Link
              to={`/admin/online-tournaments/${league._id}/edit-team-pictures`}
            >
              <Button icon={<CameraOutlined />}>
                {t.onlineTournaments.admin.editTeamPictures}
              </Button>
            </Link>
          )}
          <Link
            to={`/admin/online-tournaments/${league._id}/edit-player-pictures`}
          >
            <Button icon={<CameraOutlined />}>
              {t.onlineTournaments.admin.editPlayerPictures}
            </Button>
          </Link>
          {isRiichiCity && (
            <Button
              icon={<CloudUploadOutlined />}
              loading={savingRcTables}
              onClick={handleSaveRcTables}
            >
              {t.onlineTournaments.admin.saveRcTables}
            </Button>
          )}
        </div>
      )}
      {withTeams ? (
        <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
          {league.teams.map((team) => (
            <Card
              key={team._id}
              title={
                <span
                  style={{
                    display: "flex",
                    alignItems: "center",
                    gap: 8,
                  }}
                >
                  {team.pictures && (
                    <TeamLogo pictures={team.pictures} size="small" />
                  )}
                  {team.displayName}
                </span>
              }
              size="small"
              type="inner"
            >
              <List
                size="small"
                dataSource={[
                  ...team.roster.members,
                  ...team.roster.substitutes,
                ]}
                renderItem={(player: PlayerInfo, index: number) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <PlayerAvatar
                          src={player.avatarUrl}
                          leaguePicture={player.leaguePicture}
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
                          {index >= team.roster.members.length && (
                            <Tag style={{ marginLeft: 8 }} color="orange">
                              {t.onlineTournaments.substitute}
                            </Tag>
                          )}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          ))}
        </div>
      ) : (
        <List
          size="small"
          dataSource={league.players}
          renderItem={(player: PlayerInfo) => (
            <List.Item>
              <List.Item.Meta
                avatar={
                  <PlayerAvatar
                    src={player.avatarUrl}
                    leaguePicture={player.leaguePicture}
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
                  </span>
                }
              />
            </List.Item>
          )}
        />
      )}
      {league.officialSubstitutes?.length > 0 && (
        <Card
          title={t.onlineTournaments.officialSubstitutes}
          size="small"
          type="inner"
          style={{ marginTop: 16 }}
        >
          <List
            size="small"
            dataSource={league.officialSubstitutes}
            renderItem={(player: PlayerInfo) => (
              <List.Item>
                <List.Item.Meta
                  avatar={
                    <PlayerAvatar
                      src={player.avatarUrl}
                      leaguePicture={player.leaguePicture}
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
                      <Tag style={{ marginLeft: 8 }} color="purple">
                        {t.onlineTournaments.officialSubstitute}
                      </Tag>
                    </span>
                  }
                />
              </List.Item>
            )}
          />
        </Card>
      )}
    </div>
  );

  const hasFinalsRoster =
    withTeams && league.teams.some((team) => team.finalsRoster);

  const finalsRosterTab = hasFinalsRoster ? (
    <div>
      {canEdit && (
        <div style={{ marginBottom: 16, textAlign: "right" }}>
          <Link
            to={`/admin/online-tournaments/${league._id}/edit-finals-roster`}
          >
            <Button type="primary" icon={<EditOutlined />}>
              {t.onlineTournaments.admin.editFinalsRoster}
            </Button>
          </Link>
        </div>
      )}
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        {league.teams.map((team) => {
          const fr = team.finalsRoster;
          if (!fr) {
            return null;
          }
          return (
            <Card
              key={team._id}
              title={team.displayName}
              size="small"
              type="inner"
            >
              <List
                size="small"
                dataSource={[...fr.members, ...fr.substitutes]}
                renderItem={(player: PlayerInfo, index: number) => (
                  <List.Item>
                    <List.Item.Meta
                      avatar={
                        <PlayerAvatar
                          src={player.avatarUrl}
                          leaguePicture={player.leaguePicture}
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
                          {index >= fr.members.length && (
                            <Tag style={{ marginLeft: 8 }} color="orange">
                              {t.onlineTournaments.substitute}
                            </Tag>
                          )}
                        </span>
                      }
                    />
                  </List.Item>
                )}
              />
            </Card>
          );
        })}
      </div>
    </div>
  ) : null;

  const tabItems = [
    {
      key: "presentation",
      label: (
        <span>
          <InfoCircleOutlined /> {t.onlineTournaments.tabPresentation}
        </span>
      ),
      children: presentationTab,
    },
    {
      key: "rules",
      label: (
        <span>
          <FileTextOutlined /> {t.onlineTournaments.tabRules}
        </span>
      ),
      children: rulesTab,
    },
    {
      key: "players",
      label: (
        <span>
          <TeamOutlined /> {t.onlineTournaments.tabPlayerList}
        </span>
      ),
      children: playerListTab,
    },
    ...(hasFinalsRoster
      ? [
          {
            key: "finals-roster",
            label: (
              <span>
                <TrophyOutlined /> {t.onlineTournaments.tabFinalsRoster}
              </span>
            ),
            children: finalsRosterTab,
          },
        ]
      : []),
  ];

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
      <Link to="/">
        <Button size="small" style={{ marginBottom: 12 }}>
          ← {t.onlineTournaments.backToList}
        </Button>
      </Link>

      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          flexWrap: "wrap",
          gap: 12,
          marginBottom: 16,
        }}
      >
        <Title level={2} style={{ margin: 0 }}>
          {league.name}
        </Title>
      </div>

      <Tabs defaultActiveKey="presentation" items={tabItems} />
    </div>
  );
}
