import { useParams, Link } from "react-router";
import { Button } from "antd";
import { ArrowLeftOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import Statistics from "./statistics";

export function meta() {
  return [{ title: "Statistics - TNT Paris Mahjong" }];
}

export default function LeagueStatisticsPage() {
  const { slug } = useParams<{ slug: string }>();
  const { t } = useLocale();

  return (
    <div>
      <div style={{ marginBottom: 8 }}>
        <Link to={`/online-tournaments/${slug}`}>
          <Button icon={<ArrowLeftOutlined />} size="small">
            {t.onlineTournaments.backToLeague}
          </Button>
        </Link>
      </div>
      <Statistics leagueSlug={slug} />
    </div>
  );
}
