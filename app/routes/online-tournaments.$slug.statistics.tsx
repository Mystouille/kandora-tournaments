import { useParams } from "react-router";
import Statistics from "./statistics";

export function meta() {
  return [{ title: "Statistics - TNT Paris Mahjong" }];
}

export default function LeagueStatisticsPage() {
  const { slug, tab } = useParams<{ slug: string; tab?: string }>();
  return <Statistics leagueSlug={slug} tabRoute={tab} />;
}
