import { useEffect, useRef, useState } from "react";
import { Link } from "react-router";
import { Button, Tooltip, message } from "antd";
import {
  AlignLeftOutlined,
  ArrowLeftOutlined,
  LineChartOutlined,
  OrderedListOutlined,
  ShareAltOutlined,
} from "@ant-design/icons";
import { useLocale } from "~/contexts/LocaleContext";
import type {
  GameSummaryScreen,
  LeagueGameSummary,
} from "~/types/leagueGameSummary";
import { GameStatsScreen } from "./GameStatsScreen";
import { GamePointsScreen } from "./GamePointsScreen";
import { GameStandingsScreen } from "./GameStandingsScreen";
import "./gameSummary.css";

export function GameSummaryPage({
  summary,
  returnTo,
}: {
  summary: LeagueGameSummary;
  returnTo: string;
}) {
  const { t, locale } = useLocale();
  const labels = t.gameSummary;
  const [screen, setScreen] = useState<GameSummaryScreen>("stats");
  const [exporting, setExporting] = useState(false);
  const [width, setWidth] = useState(960);
  const viewport = useRef<HTMLDivElement>(null);
  const canvas = useRef<HTMLElement>(null);
  useEffect(() => {
    const element = viewport.current;
    if (!element) {
      return;
    }
    const observer = new ResizeObserver(([entry]) =>
      setWidth(entry.contentRect.width)
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const buttons = [
    { screen: "stats", label: labels.stats, icon: <AlignLeftOutlined /> },
    { screen: "points", label: labels.points, icon: <LineChartOutlined /> },
    {
      screen: "standings",
      label: labels.standings,
      icon: <OrderedListOutlined />,
    },
  ] satisfies {
    screen: GameSummaryScreen;
    label: string;
    icon: React.ReactNode;
  }[];
  const startTime = new Date(summary.startTime);
  const endTime = summary.endTime ? new Date(summary.endTime) : null;
  const date = endTime ?? startTime;
  const timeFormat = new Intl.DateTimeFormat(locale, {
    hour: "2-digit",
    minute: "2-digit",
  });
  const exportImage = async () => {
    if (exporting) {
      return;
    }
    setExporting(true);
    try {
      if (!canvas.current) {
        throw new Error("The summary canvas is not available");
      }
      const { downloadGameSummary } = await import("~/utils/exportGameSummary");
      await downloadGameSummary(
        canvas.current,
        `${summary.league.slug}-${summary.id}-${screen}`
      );
      message.success(labels.exportSuccess);
    } catch (error) {
      console.error("[game summary] Image export failed", error);
      message.error(labels.exportFailed);
    } finally {
      setExporting(false);
    }
  };
  return (
    <main className="game-summary-page">
      <div className="gs-toolbar">
        <Link className="gs-back" to={returnTo}>
          <ArrowLeftOutlined aria-hidden /> {labels.back}
        </Link>
        <div className="gs-actions">
          <div
            className="gs-screen-buttons"
            role="group"
            aria-label={labels.title}
          >
            {buttons.map((button) => (
              <Tooltip title={button.label} key={button.screen}>
                <Button
                  type={screen === button.screen ? "primary" : "default"}
                  icon={button.icon}
                  aria-label={button.label}
                  aria-pressed={screen === button.screen}
                  disabled={exporting}
                  onClick={() => setScreen(button.screen)}
                />
              </Tooltip>
            ))}
          </div>
          <Button
            icon={<ShareAltOutlined aria-hidden />}
            aria-label={labels.share}
            loading={exporting}
            onClick={() => void exportImage()}
          >
            {exporting ? labels.exporting : labels.share}
          </Button>
        </div>
      </div>
      <p className="gs-pan-hint">{labels.panHint}</p>
      <div className="gs-viewport" ref={viewport}>
        <div
          className="gs-preview"
          style={{ zoom: Math.min(1, Math.max(760, width) / 1920) }}
        >
          <article
            ref={canvas}
            className={`gs-canvas${screen === "standings" ? " gs-canvas-tall" : ""}`}
            data-summary-canvas={screen}
            aria-label={labels[screen]}
          >
            <header className="gs-header">
              <div>
                <div className="gs-kicker">
                  <span>KANDORA</span> / {labels.report}
                </div>
                <h1>{summary.league.name}</h1>
                <div className="gs-subheading">
                  <span>{labels[screen]}</span>
                  {summary.phaseId && (
                    <span className="gs-phase">{summary.phaseId}</span>
                  )}
                </div>
              </div>
              <div className="gs-date">
                <time dateTime={date.toISOString()}>
                  {date.toLocaleDateString(locale, {
                    day: "numeric",
                    month: "long",
                    year: "numeric",
                  })}
                </time>
                <span className="gs-time-range">
                  <time dateTime={startTime.toISOString()}>
                    {timeFormat.format(startTime)}
                  </time>
                  {" \u2013 "}
                  {endTime ? (
                    <time dateTime={endTime.toISOString()}>
                      {timeFormat.format(endTime)}
                    </time>
                  ) : (
                    "\u2014"
                  )}
                </span>
              </div>
            </header>
            <div className="gs-content">
              {screen === "stats" && <GameStatsScreen summary={summary} />}
              {screen === "points" && <GamePointsScreen summary={summary} />}
              {screen === "standings" && (
                <GameStandingsScreen summary={summary} />
              )}
            </div>
            <footer className="gs-footer">
              <span>
                {summary.handCount === null
                  ? labels.title
                  : `${summary.handCount} ${labels.hands}${summary.drawCount === null ? "" : ` / ${summary.drawCount} ${labels.draws}`}`}
              </span>
              {!summary.isCounted && (
                <span className="gs-excluded">{labels.excluded}</span>
              )}
              <span className="gs-game-id">
                {summary.platformGameId ?? summary.id}
              </span>
            </footer>
          </article>
        </div>
      </div>
    </main>
  );
}
