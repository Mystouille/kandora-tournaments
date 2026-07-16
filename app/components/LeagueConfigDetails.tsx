import type { ReactNode } from "react";
import { Descriptions, Space, Tag, Typography } from "antd";
import type {
  FinalPhaseDefinition,
  FinalStageDefinition,
  LeagueTypeConfig,
  Rational,
  RegularPhaseDefinition,
  RegularScoringConfig,
} from "../db/types/league-config";
import { useLocale } from "../contexts/LocaleContext";
import type { ConfigT } from "./admin/leagueTypeConfig/types";

const { Text } = Typography;

function formatRational(r: Rational): string {
  if (r.den === 1) {
    return String(r.num);
  }
  return `${r.num}/${r.den}`;
}

function renderScoring(scoring: RegularScoringConfig, ct: ConfigT): ReactNode {
  if (scoring.type === "team-delta-cap") {
    return (
      <Space size={4} wrap>
        <Tag color="blue">{ct.teamDeltaCap}</Tag>
        <Text type="secondary">
          {ct.capPercent}: {Math.round(scoring.capPercent * 100)}% ·{" "}
          {ct.minGamesForCap}: {scoring.minGamesForCap}
        </Text>
      </Space>
    );
  }
  if (scoring.type === "best-consecutive-window") {
    const hasQualification =
      scoring.qualificationMode === "faction-top-n" &&
      scoring.qualificationCount != null;
    return (
      <Space size={4} wrap>
        <Tag color="blue">{ct.bestConsecutiveWindow}</Tag>
        <Text type="secondary">
          {ct.windowSize}: {scoring.windowSize}
          {hasQualification
            ? ` · ${ct.factionTopN}: ${scoring.qualificationCount}`
            : ""}
        </Text>
      </Space>
    );
  }
  return <Tag color="blue">{ct.cumulative}</Tag>;
}

function RegularPhaseBlock({
  phase,
  ct,
}: {
  phase: RegularPhaseDefinition;
  ct: ConfigT;
}) {
  return (
    <Descriptions
      column={1}
      size="small"
      bordered
      style={{ marginTop: 8 }}
      title={
        <Text>
          {ct.phaseId}: <Tag>{phase.id}</Tag>
        </Text>
      }
    >
      <Descriptions.Item label={ct.scoringType}>
        {renderScoring(phase.scoring, ct)}
      </Descriptions.Item>
      {phase.minGames != null && phase.minGames > 0 && (
        <Descriptions.Item label={ct.minGamesToQualify}>
          {phase.minGames}
        </Descriptions.Item>
      )}
      {phase.progression && (
        <Descriptions.Item label={ct.advancingCount}>
          {phase.progression.advancingCount}
        </Descriptions.Item>
      )}
      {phase.progression && (
        <Descriptions.Item label={ct.scoreRetention}>
          {formatRational(phase.progression.scoreRetention)}
        </Descriptions.Item>
      )}
    </Descriptions>
  );
}

function FinalStageBlock({
  stage,
  ct,
}: {
  stage: FinalStageDefinition;
  ct: ConfigT;
}) {
  return (
    <Descriptions
      column={1}
      size="small"
      bordered
      style={{ marginTop: 8 }}
      title={
        <Text>
          {ct.stageId}: <Tag>{stage.id}</Tag>
        </Text>
      }
    >
      <Descriptions.Item label={ct.gameCount}>
        {stage.gameCount}
      </Descriptions.Item>
      {stage.seeds.length > 0 && (
        <Descriptions.Item label={ct.directSeeds}>
          {stage.seeds.join(", ")}
        </Descriptions.Item>
      )}
      {stage.fromStages.length > 0 && (
        <Descriptions.Item label={ct.fromStages}>
          <Space direction="vertical" size={2}>
            {stage.fromStages.map((edge) => (
              <span key={edge.stageId}>
                <Tag>{edge.stageId}</Tag>
                <Text type="secondary">
                  {edge.places && edge.places.length > 0
                    ? `${ct.places}: ${edge.places.join(", ")}`
                    : `${ct.top} ${edge.topN}`}
                </Text>
              </span>
            ))}
          </Space>
        </Descriptions.Item>
      )}
      {stage.scoreCarryOver && (
        <Descriptions.Item label={ct.interStageCarryOver}>
          {formatRational(stage.scoreCarryOver)}
        </Descriptions.Item>
      )}
      {stage.slice != null && (
        <Descriptions.Item label={ct.slice}>{stage.slice}</Descriptions.Item>
      )}
    </Descriptions>
  );
}

function FinalPhaseBlock({
  finalPhase,
  ct,
}: {
  finalPhase: FinalPhaseDefinition;
  ct: ConfigT;
}) {
  return (
    <div>
      <Descriptions
        column={1}
        size="small"
        bordered
        style={{ marginTop: 8 }}
        title={
          <Text>
            {ct.finalPhaseId}: <Tag>{finalPhase.id}</Tag>
          </Text>
        }
      >
        <Descriptions.Item label={ct.regularToFinalsCarryOver}>
          {formatRational(finalPhase.scoreCarryOver)}
        </Descriptions.Item>
      </Descriptions>
      <Text strong style={{ display: "block", marginTop: 12 }}>
        {ct.bracketStages}
      </Text>
      {finalPhase.stages.map((stage) => (
        <FinalStageBlock key={stage.id} stage={stage} ct={ct} />
      ))}
    </div>
  );
}

interface LeagueConfigDetailsProps {
  config: LeagueTypeConfig;
}

export function LeagueConfigDetails({ config }: LeagueConfigDetailsProps) {
  const { t } = useLocale();
  const ct = t.onlineTournaments.admin.config;

  const regularPhases: RegularPhaseDefinition[] =
    config.regularPhases && config.regularPhases.length > 0
      ? config.regularPhases
      : config.regularPhase
        ? [config.regularPhase]
        : [];

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      {regularPhases.length > 0 && (
        <div>
          <Text strong>{ct.regularPhaseSection}</Text>
          {regularPhases.map((phase) => (
            <RegularPhaseBlock key={phase.id} phase={phase} ct={ct} />
          ))}
        </div>
      )}
      {config.finalPhase && (
        <div>
          <Text strong>{ct.finalPhaseSection}</Text>
          <FinalPhaseBlock finalPhase={config.finalPhase} ct={ct} />
        </div>
      )}
    </div>
  );
}
