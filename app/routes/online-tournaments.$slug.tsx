import { useEffect, useState } from "react";
import { Navigate, useLocation, useNavigate, useParams } from "react-router";
import type { Route } from "./+types/online-tournaments.$slug";
import {
  Typography,
  Tabs,
  Spin,
  Collapse,
  Descriptions,
  List,
  Space,
  Tag,
  Card,
  Result,
} from "antd";
import {
  CalendarOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  TrophyOutlined,
  TeamOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import { getTournamentText } from "../utils/tournament";
import { ArticleContent } from "../components/ArticleContent";
import { TeamLogo } from "../components/TeamLogo";
import { PlayerAvatar } from "../components/PlayerAvatar";
import { LeagueConfigDetails } from "../components/LeagueConfigDetails";
import type { LeagueTypeConfig } from "../core/types/league-config";
import { TournamentScheduleTab } from "../components/TournamentScheduleTab";
import { LeagueModel } from "../core/models/tournament/League";
import { connectToDatabase } from "../utils/dbConnection.server";
import { slugify } from "../utils/slugify";
import {
  isTournamentInfoTabKey,
  resolveTournamentInfoTab,
  tournamentInfoTabRouteFromKey,
} from "../components/tournamentInfoTabRoutes";

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
  hasSchedule: boolean;
  rulesConfig: {
    gameRules: string;
    isTeamMode: boolean;
  };
  leagueTypeConfigName: string | null;
  leagueTypeConfig: LeagueTypeConfig | null;
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

interface TournamentPageMetadata {
  title: string;
  description: string;
  canonicalUrl: string;
  imageUrl: string;
  imageAlt: string;
  locale: "en_GB" | "fr_FR";
  hasCoverImage: boolean;
}

interface TournamentLoaderData {
  metadata: TournamentPageMetadata;
}

function publicOrigin(request: Request): string {
  const forwardedProto = request.headers.get("X-Forwarded-Proto");
  const forwardedHost =
    request.headers.get("X-Forwarded-Host") ?? request.headers.get("Host");
  if (forwardedProto && forwardedHost) {
    return `${forwardedProto}://${forwardedHost}`;
  }
  return new URL(request.url).origin;
}

function absoluteUrl(value: string, origin: string): string {
  try {
    return new URL(value, `${origin}${basePath}/`).toString();
  } catch {
    return `${origin}${basePath}/banner/TNT_logo-BLACK.png`;
  }
}

function fallbackMetadata(
  request: Request,
  slug: string
): TournamentPageMetadata {
  const origin = publicOrigin(request);
  return {
    title: "Online Tournament | TNT Paris Mahjong",
    description:
      "Online mahjong tournament details, schedule, players, standings, and results.",
    canonicalUrl: `${origin}${basePath}/online-tournaments/${encodeURIComponent(slug)}`,
    imageUrl: `${origin}${basePath}/banner/TNT_logo-BLACK.png`,
    imageAlt: "TNT Paris Mahjong",
    locale: "en_GB",
    hasCoverImage: false,
  };
}

export async function loader({ params, request }: Route.LoaderArgs) {
  const slug = params.slug ?? "";
  const fallback = fallbackMetadata(request, slug);

  try {
    await connectToDatabase();
    const leagues = await LeagueModel.find({ isDisplayed: true })
      .select("name summary coverImageUrl platformConfig.platformName")
      .lean();
    const league = leagues.find((item) => slugify(item.name) === slug);
    if (!league) {
      return { metadata: fallback } satisfies TournamentLoaderData;
    }

    const language = request.headers
      .get("Accept-Language")
      ?.toLowerCase()
      .startsWith("en")
      ? "en"
      : "fr";
    const summary =
      league.summary?.[language]?.trim() ||
      league.summary?.fr?.trim() ||
      league.summary?.en?.trim();
    const platform = league.platformConfig?.platformName;
    const description =
      summary ||
      (language === "fr"
        ? `Tournoi de mahjong en ligne${platform ? ` sur ${platform}` : ""}. Programme, joueurs, classement et résultats.`
        : `Online mahjong tournament${platform ? ` on ${platform}` : ""}. Schedule, players, standings, and results.`);
    const coverImageUrl = league.coverImageUrl?.trim() ?? "";

    return {
      metadata: {
        ...fallback,
        title: `${league.name} | TNT Paris Mahjong`,
        description,
        imageUrl: coverImageUrl
          ? absoluteUrl(coverImageUrl, publicOrigin(request))
          : fallback.imageUrl,
        imageAlt: league.name,
        locale: language === "fr" ? "fr_FR" : "en_GB",
        hasCoverImage: Boolean(coverImageUrl),
      },
    } satisfies TournamentLoaderData;
  } catch (error) {
    console.error("Failed to load online tournament metadata:", error);
    return { metadata: fallback } satisfies TournamentLoaderData;
  }
}

export function meta({ data }: { data?: TournamentLoaderData }) {
  const metadata = data?.metadata;
  if (!metadata) {
    return [{ title: "Online Tournament | TNT Paris Mahjong" }];
  }

  return [
    { title: metadata.title },
    { name: "description", content: metadata.description },
    { tagName: "link", rel: "canonical", href: metadata.canonicalUrl },
    { property: "og:title", content: metadata.title },
    { property: "og:description", content: metadata.description },
    { property: "og:type", content: "website" },
    { property: "og:site_name", content: "TNT Paris Mahjong" },
    { property: "og:locale", content: metadata.locale },
    { property: "og:url", content: metadata.canonicalUrl },
    { property: "og:image", content: metadata.imageUrl },
    { property: "og:image:alt", content: metadata.imageAlt },
    {
      name: "twitter:card",
      content: metadata.hasCoverImage ? "summary_large_image" : "summary",
    },
    { name: "twitter:title", content: metadata.title },
    { name: "twitter:description", content: metadata.description },
    { name: "twitter:image", content: metadata.imageUrl },
    { name: "twitter:image:alt", content: metadata.imageAlt },
  ];
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
}

function formatDateTime(iso: string, locale: string): string {
  return new Date(iso).toLocaleString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export default function LeagueDetailPage() {
  const { slug, tab } = useParams<{ slug: string; tab?: string }>();
  const location = useLocation();
  const navigate = useNavigate();
  const { t, locale } = useLocale();
  const [league, setLeague] = useState<LeagueDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);

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
      />
    );
  }

  const withTeams = league.withTeams ?? false;

  const presentationHtml = getTournamentText(league.presentation, locale);

  const presentationTab = (
    <div>
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
          {league.leagueTypeConfig && (
            <Collapse
              ghost
              size="small"
              style={{ marginTop: 8 }}
              items={[
                {
                  key: "config",
                  label: t.onlineTournaments.configDetails,
                  children: (
                    <LeagueConfigDetails config={league.leagueTypeConfig} />
                  ),
                },
              ]}
            />
          )}
        </Descriptions.Item>
        {league.phaseCutoffTimes?.length > 0 && (
          <Descriptions.Item label={t.onlineTournaments.phaseCutoffDates}>
            <Space direction="vertical" size={2}>
              {league.phaseCutoffTimes.map((iso, index) => (
                <Text key={iso}>
                  {t.onlineTournaments.admin.cutoffDateLabel.replace(
                    "{n}",
                    String(index + 1)
                  )}
                  : {formatDateTime(iso, locale)}
                </Text>
              ))}
            </Space>
          </Descriptions.Item>
        )}
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

  const playerListTab = (
    <div>
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
    ...(league.hasSchedule
      ? [
          {
            key: "schedule",
            label: (
              <span>
                <CalendarOutlined /> {t.onlineTournaments.tabSchedule}
              </span>
            ),
            children: <TournamentScheduleTab leagueId={league._id} />,
          },
        ]
      : []),
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
            key: "finalsRoster",
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

  const resolvedActiveTab = resolveTournamentInfoTab(tab, {
    showSchedule: league.hasSchedule,
    showFinalsRoster: hasFinalsRoster,
  });
  const canonicalTabRoute = tournamentInfoTabRouteFromKey(resolvedActiveTab);
  const canonicalPath = `/online-tournaments/${encodeURIComponent(league.slug)}/${canonicalTabRoute}`;
  if (tab !== canonicalTabRoute) {
    return (
      <Navigate
        replace
        to={{
          pathname: canonicalPath,
          search: location.search,
          hash: location.hash,
        }}
      />
    );
  }

  const handleTabChange = (nextTab: string) => {
    if (!isTournamentInfoTabKey(nextTab)) {
      return;
    }
    void navigate({
      pathname: `/online-tournaments/${encodeURIComponent(league.slug)}/${tournamentInfoTabRouteFromKey(nextTab)}`,
      search: location.search,
      hash: location.hash,
    });
  };

  return (
    <div style={{ padding: "24px", maxWidth: 960, margin: "0 auto" }}>
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

      <Tabs
        activeKey={resolvedActiveTab}
        items={tabItems}
        onChange={handleTabChange}
      />
    </div>
  );
}
