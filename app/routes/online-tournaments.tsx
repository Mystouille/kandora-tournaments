import { useEffect, useState } from "react";
import { Link } from "react-router";
import { Button, Card, Col, Empty, Row, Spin, Tag, Typography } from "antd";
import {
  CalendarOutlined,
  PlusOutlined,
  TeamOutlined,
  PlayCircleOutlined,
  TrophyOutlined,
} from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { basePath } from "../utils/basePath";
import { PageTitle } from "../components/PageTitle";

const { Title, Text, Paragraph } = Typography;

interface LeagueSummary {
  _id: string;
  name: string;
  slug: string;
  startTime: string;
  endTime: string;
  summary: { fr: string; en: string };
  coverImageUrl: string;
  playerCount: number;
  teamCount: number;
  gameCount: number;
  rulesConfig: {
    gameRules: string;
    isTeamMode: boolean;
  };
}

type TournamentStatus = "upcoming" | "ongoing" | "finished";

function getStatus(startTime: string, endTime: string): TournamentStatus {
  const now = Date.now();
  const start = new Date(startTime).getTime();
  const end = new Date(endTime).getTime();
  if (now < start) {
    return "upcoming";
  }
  if (now > end) {
    return "finished";
  }
  return "ongoing";
}

export function meta() {
  return [
    { title: "Online Tournaments - TNT Paris Mahjong" },
    {
      name: "description",
      content: "Browse online mahjong tournaments and leagues",
    },
  ];
}

function formatDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "fr" ? "fr-FR" : "en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export default function OnlineTournaments() {
  const { t, locale } = useLocale();
  const [leagues, setLeagues] = useState<LeagueSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);

  useEffect(() => {
    fetch(`${basePath}/api/online-tournaments`)
      .then((res) => {
        if (!res.ok) {
          throw new Error("Failed to fetch");
        }
        return res.json();
      })
      .then((data) => {
        setLeagues(data);
        setLoading(false);
      })
      .catch((err) => {
        console.error(err);
        setLoading(false);
      });

    fetch(`${basePath}/api/auth/me`)
      .then((res) => res.json())
      .then((data) => {
        if (data?.user?.isAdmin) {
          setIsAdmin(true);
        }
      })
      .catch(() => {});
  }, []);

  const statusMeta: Record<TournamentStatus, { color: string; label: string }> =
    {
      upcoming: { color: "blue", label: t.onlineTournaments.statusUpcoming },
      ongoing: { color: "green", label: t.onlineTournaments.statusOngoing },
      finished: { color: "default", label: t.onlineTournaments.statusFinished },
    };

  return (
    <div style={{ width: "100%", minHeight: "100%" }}>
      <PageTitle title={t.onlineTournaments.title} />

      <div style={{ padding: "0 24px", maxWidth: 1200, margin: "0 auto" }}>
        {isAdmin && (
          <div style={{ textAlign: "center", marginBottom: 16 }}>
            <Link to="/admin/online-tournaments/new">
              <Button type="primary" icon={<PlusOutlined />}>
                {t.onlineTournaments.admin.createNew}
              </Button>
            </Link>
          </div>
        )}
        {loading ? (
          <div style={{ textAlign: "center", padding: 48 }}>
            <Spin size="large" />
          </div>
        ) : leagues.length === 0 ? (
          <Empty description={t.onlineTournaments.noLeagues} />
        ) : (
          <Row gutter={[16, 16]}>
            {leagues.map((league) => {
              const status = getStatus(league.startTime, league.endTime);
              const meta = statusMeta[status];
              const summaryText =
                locale === "fr"
                  ? league.summary?.fr
                  : league.summary?.en || league.summary?.fr;
              const isTeamMode = league.rulesConfig?.isTeamMode ?? false;
              return (
                <Col
                  key={league._id}
                  xs={24}
                  sm={12}
                  lg={8}
                  style={{ display: "flex" }}
                >
                  <Card
                    hoverable
                    style={{
                      width: "100%",
                      height: "100%",
                      display: "flex",
                      flexDirection: "column",
                    }}
                    styles={{
                      body: {
                        flex: 1,
                        display: "flex",
                        flexDirection: "column",
                        gap: 8,
                      },
                    }}
                    cover={
                      <Link to={`/online-tournaments/${league.slug}`}>
                        {league.coverImageUrl ? (
                          <img
                            src={league.coverImageUrl}
                            alt={league.name}
                            style={{
                              height: 160,
                              width: "100%",
                              objectFit: "cover",
                            }}
                          />
                        ) : (
                          <div
                            style={{
                              height: 160,
                              display: "flex",
                              alignItems: "center",
                              justifyContent: "center",
                              background:
                                "linear-gradient(135deg, #722ed1, #1677ff)",
                            }}
                          >
                            <TrophyOutlined
                              style={{
                                fontSize: 48,
                                color: "rgba(255,255,255,0.85)",
                              }}
                            />
                          </div>
                        )}
                      </Link>
                    }
                  >
                    <div
                      style={{
                        display: "flex",
                        justifyContent: "space-between",
                        alignItems: "center",
                        gap: 8,
                      }}
                    >
                      <Tag color={meta.color} style={{ margin: 0 }}>
                        {meta.label}
                      </Tag>
                      <Text type="secondary" style={{ fontSize: 12 }}>
                        <CalendarOutlined />{" "}
                        {formatDate(league.startTime, locale)} —{" "}
                        {formatDate(league.endTime, locale)}
                      </Text>
                    </div>

                    <Link to={`/online-tournaments/${league.slug}`}>
                      <Title level={4} style={{ margin: 0 }}>
                        {league.name}
                      </Title>
                    </Link>

                    {summaryText ? (
                      <Paragraph
                        type="secondary"
                        ellipsis={{ rows: 2 }}
                        style={{ margin: 0 }}
                      >
                        {summaryText}
                      </Paragraph>
                    ) : null}

                    <div
                      style={{
                        display: "flex",
                        flexWrap: "wrap",
                        gap: 16,
                        marginTop: "auto",
                        paddingTop: 8,
                      }}
                    >
                      <Text type="secondary">
                        <PlayCircleOutlined /> {league.gameCount}{" "}
                        {t.onlineTournaments.gameCount}
                      </Text>
                      {isTeamMode ? (
                        <Text type="secondary">
                          <TrophyOutlined /> {league.teamCount}{" "}
                          {t.onlineTournaments.teamCount}
                        </Text>
                      ) : null}
                      <Text type="secondary">
                        <TeamOutlined /> {league.playerCount}{" "}
                        {t.onlineTournaments.playerCount}
                      </Text>
                    </div>
                  </Card>
                </Col>
              );
            })}
          </Row>
        )}
      </div>
    </div>
  );
}
