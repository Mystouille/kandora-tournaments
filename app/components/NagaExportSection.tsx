import { useMemo, useState } from "react";
import { Alert, Button, Card, Input, Select, Space, Typography } from "antd";
import { CopyOutlined, ReloadOutlined } from "@ant-design/icons";
import { useLocale } from "../contexts/LocaleContext";
import { inferReplaySource } from "../game/replay/inferSource";
import { normalizeReplayId } from "../game/replay/normalizeReplayId";
import { basePath } from "../utils/basePath";
import {
  buildNagaRoundUrl,
  formatNagaRoundLabel,
  type NagaRoundLabels,
  type Tenhou5LogShape,
} from "../utils/nagaExport";

/**
 * "Export for Naga review" section. Lets the user paste a Mahjong
 * Soul replay id, fetch the converted tenhou.net/5 log, pick which
 * rounds to send to Naga, and copy one viewer URL per selected
 * round to the clipboard (newline-separated).
 */
export function NagaExportSection() {
  const { t } = useLocale();
  const [rawId, setRawId] = useState("");
  const [log, setLog] = useState<Tenhou5LogShape | null>(null);
  const [selected, setSelected] = useState<number[]>([]);
  const [fetching, setFetching] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [copyFlash, setCopyFlash] = useState<string | null>(null);

  const cleanedId = useMemo(() => normalizeReplayId(rawId), [rawId]);
  const detectedSource = useMemo(
    () => (cleanedId ? inferReplaySource(cleanedId) : null),
    [cleanedId]
  );

  const isTenhou = detectedSource === "tenhou";
  // The server supports majsoul + riichicity. Tenhou ids get a
  // warning instead because tenhou.net itself already exposes the
  // logs Naga needs.
  const canFetch =
    (detectedSource === "majsoul" || detectedSource === "riichicity") &&
    !fetching;

  const roundLabels: NagaRoundLabels = useMemo(
    () => ({
      ron: t.review.naga.roundRon,
      tsumo: t.review.naga.roundTsumo,
      draw: t.review.naga.roundDraw,
      nagashiMangan: t.review.naga.roundNagashiMangan,
      kyuushuKyuuhai: t.review.naga.roundKyuushuKyuuhai,
      suufonRenda: t.review.naga.roundSuufonRenda,
      suuchaRiichi: t.review.naga.roundSuuchaRiichi,
      suukaikan: t.review.naga.roundSuukaikan,
      sanchahou: t.review.naga.roundSanchahou,
      unknown: t.review.naga.roundUnknown,
    }),
    [t]
  );

  const onFetch = async () => {
    if (!canFetch) {
      return;
    }
    setFetching(true);
    setError(null);
    setLog(null);
    setSelected([]);
    setCopyFlash(null);
    try {
      const res = await fetch(
        `${basePath}/api/replay-tenhou-log?gameId=${encodeURIComponent(
          cleanedId
        )}&format=net5`,
        { cache: "no-store" }
      );
      if (!res.ok) {
        throw new Error(`HTTP ${res.status}`);
      }
      const parsed = (await res.json()) as Tenhou5LogShape;
      setLog(parsed);
    } catch (e) {
      console.error("[naga-export] fetch failed", e);
      setError(t.review.naga.fetchError);
    } finally {
      setFetching(false);
    }
  };

  const onCopy = async () => {
    if (!log || selected.length === 0) {
      return;
    }
    try {
      const urls = selected
        .slice()
        .sort((a, b) => a - b)
        .map((idx) => buildNagaRoundUrl(log, idx))
        .join("\n");
      await navigator.clipboard.writeText(urls);
      setCopyFlash(
        t.review.naga.copySuccess.replace("{count}", String(selected.length))
      );
    } catch (e) {
      console.error("[naga-export] copy failed", e);
      setError(t.review.naga.copyError);
    }
  };

  const options = useMemo(() => {
    if (!log) {
      return [];
    }
    return log.log.map((round, idx) => ({
      value: idx,
      label: formatNagaRoundLabel(round, log.name, roundLabels),
    }));
  }, [log, roundLabels]);

  return (
    <Card
      style={{ maxWidth: 720, margin: "16px auto 0" }}
      title={t.review.naga.sectionTitle}
    >
      <Space direction="vertical" size={16} style={{ width: "100%" }}>
        <Typography.Text>{t.review.naga.sectionDescription}</Typography.Text>

        <div
          style={{
            display: "flex",
            gap: 8,
            alignItems: "stretch",
            flexWrap: "wrap",
          }}
        >
          <Input
            placeholder={t.review.naga.placeholder}
            value={rawId}
            onChange={(e) => {
              setRawId(e.target.value);
              setLog(null);
              setSelected([]);
              setError(null);
              setCopyFlash(null);
            }}
            onPressEnter={onFetch}
            disabled={fetching}
            style={{ flex: "1 1 240px", minWidth: 240 }}
            size="large"
          />
          <Button
            type="primary"
            size="large"
            icon={<ReloadOutlined />}
            loading={fetching}
            onClick={onFetch}
            disabled={!canFetch}
          >
            {fetching ? t.review.naga.fetching : t.review.naga.fetchLog}
          </Button>
        </div>

        {isTenhou && (
          <Alert
            type="warning"
            showIcon
            message={t.review.naga.tenhouWarning}
          />
        )}

        {error && <Alert type="error" showIcon message={error} closable />}

        {log && options.length > 0 && (
          <>
            <Select
              mode="multiple"
              size="large"
              style={{ width: "100%" }}
              placeholder={t.review.naga.selectRoundsPlaceholder}
              value={selected}
              onChange={(v) => setSelected(v as number[])}
              options={options}
              optionFilterProp="label"
            />
            <Button
              size="large"
              icon={<CopyOutlined />}
              onClick={onCopy}
              disabled={selected.length === 0}
            >
              {t.review.naga.copyLogs}
            </Button>
            {copyFlash && (
              <Typography.Text type="success">{copyFlash}</Typography.Text>
            )}
          </>
        )}
      </Space>
    </Card>
  );
}
