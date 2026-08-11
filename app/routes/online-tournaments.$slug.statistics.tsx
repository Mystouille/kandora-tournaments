import { useParams } from "react-router";
import Statistics from "./statistics";

export function meta() {
  return [{ title: "Statistics - TNT Paris Mahjong" }];
}

export default function LeagueStatisticsPage() {
  const { slug } = useParams<{ slug: string }>();
  return <Statistics leagueSlug={slug} />;
}
