import { useEffect, useMemo, useRef, useState } from "react";
import {
  Button,
  Checkbox,
  Empty,
  Input,
  Popover,
  Select,
  Space,
  Table,
  Tag,
  Typography,
} from "antd";
import type { TableColumnsType, TableProps } from "antd";
import type { FilterDropdownProps } from "antd/es/table/interface";
import {
  CalendarOutlined,
  ClearOutlined,
  CommentOutlined,
  EyeOutlined,
  TableOutlined,
} from "@ant-design/icons";
import { Link } from "react-router";
import { useLocale } from "~/contexts/LocaleContext";
import type {
  MyReplayContext,
  MyReplayContextKind,
  MyReplayGroup,
  MyReplayReason,
  MyReplayRuleset,
} from "~/types/myReplays";
import type { ReplaySource } from "~/game/replay/types";
import mahjongSoulLogoUrl from "~/core/ui/platforms/assets/mahjongSoul.png?url";
import riichiCityLogoUrl from "~/core/ui/platforms/assets/riichi city.png?url";
import tenhouLogoUrl from "~/core/ui/platforms/assets/tenhou.png?url";
import {
  DEFAULT_MY_REPLAY_SORT,
  filterAndSortMyReplayGroups,
  type MyReplayFilters,
  type MyReplaySort,
} from "./myReplayRows";
import {
  MY_REPLAY_COLUMN_DISPLAY_ORDER,
  MY_REPLAY_TABLE_STORAGE_KEY,
  defaultMyReplayTablePreferences,
  fitMyReplayColumns,
  mergeMyReplayHeaderFilters,
  myReplayContextFilterValue,
  myReplayReasonFilterValue,
  parseMyReplayTablePreferences,
  resolveMyReplayColumnWidths,
  type MyReplayColumnKey,
} from "./myReplayTableConfig";

interface MyReplayTableRow {
  key: string;
  reasons: MyReplayReason[];
  gameDate: number | null;
  source: ReplaySource;
  context: MyReplayContext;
  ruleset: MyReplayRuleset;
  replayUrl: string;
  reviewUrl?: string;
  reviewedPlayerName?: string | null;
  lastModified: number | null;
  commentCount: number;
  treeBranch?: "middle" | "last";
  children?: MyReplayTableRow[];
}

const REASON_DISPLAY_ORDER: MyReplayReason[] = [
  "created",
  "played",
  "commented",
  "reviewed",
];

export const MY_REPLAY_PLATFORM_LOGO_ASPECT_RATIO = "16 / 9";

interface PlatformLogoPresentation {
  url: string;
  backgroundColor: "#000000" | "#ffffff";
}

const PLATFORM_LOGO_PRESENTATION: Partial<
  Record<ReplaySource, PlatformLogoPresentation>
> = {
  majsoul: { url: mahjongSoulLogoUrl, backgroundColor: "#ffffff" },
  tenhou: { url: tenhouLogoUrl, backgroundColor: "#000000" },
  riichicity: { url: riichiCityLogoUrl, backgroundColor: "#ffffff" },
};

export function myReplayPlatformLogo(
  source: ReplaySource
): PlatformLogoPresentation | null {
  return PLATFORM_LOGO_PRESENTATION[source] ?? null;
}

function PlatformCell({
  source,
  label,
}: {
  source: ReplaySource;
  label: string;
}) {
  const logo = myReplayPlatformLogo(source);
  if (!logo) {
    return label;
  }
  return (
    <span
      title={label}
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        width: 80,
        aspectRatio: MY_REPLAY_PLATFORM_LOGO_ASPECT_RATIO,
        overflow: "hidden",
        border: "1px solid rgba(0, 0, 0, 0.12)",
        borderRadius: 4,
        backgroundColor: logo.backgroundColor,
        verticalAlign: "middle",
      }}
    >
      <img
        src={logo.url}
        alt={label}
        style={{
          display: "block",
          width: "100%",
          height: "100%",
          objectFit: "contain",
        }}
      />
    </span>
  );
}

export const MY_REPLAY_HEADER_TEXT_STYLE = {
  display: "inline-block",
  maxWidth: "100%",
  whiteSpace: "normal",
  overflowWrap: "normal",
  wordBreak: "normal",
  hyphens: "none",
  lineHeight: 1.2,
} as const;

function ColumnHeaderText({ label }: { label: string }) {
  return <span style={MY_REPLAY_HEADER_TEXT_STYLE}>{label}</span>;
}

export function myReplayLinkForRow(
  row: Pick<MyReplayTableRow, "replayUrl" | "reviewUrl" | "reviewedPlayerName">
):
  | { kind: "replay"; url: string }
  | { kind: "review"; url: string; reviewedPlayerName: string | null } {
  if (row.reviewUrl) {
    return {
      kind: "review",
      url: row.reviewUrl,
      reviewedPlayerName: row.reviewedPlayerName ?? null,
    };
  }
  return { kind: "replay", url: row.replayUrl };
}

export function reviewLinkLabel(
  template: string,
  reviewedPlayerName: string | null,
  unknownPlayerName: string
): string {
  return template.replace(
    "{username}",
    reviewedPlayerName ?? unknownPlayerName
  );
}

export function toTableRows(groups: MyReplayGroup[]): MyReplayTableRow[] {
  return groups.map((group) => ({
    key: group.key,
    reasons: group.reasons,
    gameDate: group.gameDate,
    source: group.source,
    context: group.context,
    ruleset: group.ruleset,
    replayUrl: group.replayUrl,
    lastModified: null,
    commentCount: group.commentCount,
    ...(group.reviews.length > 0
      ? {
          children: group.reviews.map((review, index) => ({
            key: review.key,
            reasons: review.reasons,
            gameDate: group.gameDate,
            source: group.source,
            context: group.context,
            ruleset: group.ruleset,
            replayUrl: group.replayUrl,
            reviewUrl: review.reviewUrl,
            reviewedPlayerName: review.reviewedPlayerName,
            lastModified: review.lastModified,
            commentCount: review.commentCount,
            treeBranch: index === group.reviews.length - 1 ? "last" : "middle",
          })),
        }
      : {}),
  }));
}

function dateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function DateTimeText({ value }: { value: string }) {
  return (
    <span
      title={value}
      style={{
        display: "block",
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {value}
    </span>
  );
}

function ReplayTreeBranch({ position }: { position: "middle" | "last" }) {
  return (
    <span
      aria-hidden="true"
      style={{
        position: "relative",
        alignSelf: "stretch",
        flex: "0 0 20px",
        minHeight: 20,
        marginRight: 6,
        opacity: 0.35,
      }}
    >
      <span
        style={{
          position: "absolute",
          left: 4,
          top: -17,
          bottom: position === "last" ? "50%" : -17,
          borderLeft: "1px solid currentColor",
        }}
      />
      <span
        style={{
          position: "absolute",
          left: 4,
          top: "50%",
          width: 14,
          borderTop: "1px solid currentColor",
        }}
      />
    </span>
  );
}

function DateRangeFilter({
  value,
  startLabel,
  endLabel,
  resetLabel,
  applyLabel,
  onChange,
  onClose,
}: {
  value: [number, number] | null;
  startLabel: string;
  endLabel: string;
  resetLabel: string;
  applyLabel: string;
  onChange: (next: [number, number] | null) => void;
  onClose: () => void;
}) {
  const [start, setStart] = useState(value ? dateInputValue(value[0]) : "");
  const [end, setEnd] = useState(value ? dateInputValue(value[1]) : "");
  const hasCompleteRange = Boolean(start && end);
  const hasPartialRange = Boolean(start || end) && !hasCompleteRange;

  useEffect(() => {
    setStart(value ? dateInputValue(value[0]) : "");
    setEnd(value ? dateInputValue(value[1]) : "");
  }, [value]);

  return (
    <Space direction="vertical" size={12} style={{ padding: 12 }}>
      <Input
        type="date"
        aria-label={startLabel}
        value={start}
        max={end || undefined}
        onChange={(event) => setStart(event.target.value)}
      />
      <Input
        type="date"
        aria-label={endLabel}
        value={end}
        min={start || undefined}
        onChange={(event) => setEnd(event.target.value)}
      />
      <Space style={{ justifyContent: "flex-end", width: "100%" }}>
        <Button
          size="small"
          onClick={() => {
            setStart("");
            setEnd("");
            onChange(null);
          }}
        >
          {resetLabel}
        </Button>
        <Button
          type="primary"
          size="small"
          disabled={hasPartialRange}
          onClick={() => {
            if (hasCompleteRange) {
              onChange([
                new Date(`${start}T00:00:00`).getTime(),
                new Date(`${end}T23:59:59.999`).getTime(),
              ]);
            } else {
              onChange(null);
            }
            onClose();
          }}
        >
          {applyLabel}
        </Button>
      </Space>
    </Space>
  );
}

function DateRangeControl({
  label,
  value,
  startLabel,
  endLabel,
  resetLabel,
  applyLabel,
  onChange,
}: {
  label: string;
  value: [number, number] | null;
  startLabel: string;
  endLabel: string;
  resetLabel: string;
  applyLabel: string;
  onChange: (next: [number, number] | null) => void;
}) {
  const [open, setOpen] = useState(false);
  return (
    <Popover
      trigger="click"
      placement="bottomLeft"
      open={open}
      onOpenChange={setOpen}
      content={
        <DateRangeFilter
          value={value}
          startLabel={startLabel}
          endLabel={endLabel}
          resetLabel={resetLabel}
          applyLabel={applyLabel}
          onChange={onChange}
          onClose={() => setOpen(false)}
        />
      }
    >
      <Button
        type={value ? "primary" : "default"}
        icon={<CalendarOutlined />}
        aria-label={label}
      >
        {label}
      </Button>
    </Popover>
  );
}

export function MyReplaysTable({ groups }: { groups: MyReplayGroup[] }) {
  const { locale, t } = useLocale();
  const [filters, setFilters] = useState<MyReplayFilters>(
    () => defaultMyReplayTablePreferences().filters
  );
  const [sort, setSort] = useState<MyReplaySort>(
    () => defaultMyReplayTablePreferences().sort
  );
  const [enabledColumns, setEnabledColumns] = useState<MyReplayColumnKey[]>(
    () => defaultMyReplayTablePreferences().enabledColumns
  );
  const [pageSize, setPageSize] = useState(
    () => defaultMyReplayTablePreferences().pageSize
  );
  const [preferencesRestored, setPreferencesRestored] = useState(false);
  const [containerWidth, setContainerWidth] = useState(0);
  const tableContainerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let preferences = defaultMyReplayTablePreferences();
    try {
      preferences = parseMyReplayTablePreferences(
        localStorage.getItem(MY_REPLAY_TABLE_STORAGE_KEY)
      );
    } catch {
      // Storage may be unavailable in privacy-restricted browsers.
    }
    setFilters(preferences.filters);
    setSort(preferences.sort);
    setEnabledColumns(preferences.enabledColumns);
    setPageSize(preferences.pageSize);
    setPreferencesRestored(true);
  }, []);

  useEffect(() => {
    if (!preferencesRestored) {
      return;
    }
    try {
      localStorage.setItem(
        MY_REPLAY_TABLE_STORAGE_KEY,
        JSON.stringify({ filters, sort, enabledColumns, pageSize })
      );
    } catch {
      // Keep table controls usable when storage is unavailable.
    }
  }, [enabledColumns, filters, pageSize, preferencesRestored, sort]);

  useEffect(() => {
    const container = tableContainerRef.current;
    if (!container) {
      return;
    }
    const updateWidth = (width: number): void => {
      setContainerWidth(Math.max(0, Math.floor(width)));
    };
    updateWidth(container.getBoundingClientRect().width);
    if (typeof ResizeObserver === "undefined") {
      const onResize = (): void => {
        updateWidth(container.getBoundingClientRect().width);
      };
      window.addEventListener("resize", onResize);
      return () => window.removeEventListener("resize", onResize);
    }
    const observer = new ResizeObserver(([entry]) => {
      updateWidth(entry.contentRect.width);
    });
    observer.observe(container);
    return () => observer.disconnect();
  }, []);

  const platformLabels: Record<ReplaySource, string> = {
    ingame: t.myReplays.platforms.ingame,
    majsoul: t.myReplays.platforms.majsoul,
    tenhou: t.myReplays.platforms.tenhou,
    riichicity: t.myReplays.platforms.riichicity,
  };
  const contextLabels: Record<MyReplayContextKind, string> = {
    friendly: t.myReplays.contexts.friendly,
    tournament: t.myReplays.contexts.tournament,
    external: t.myReplays.contexts.external,
  };
  const reasonLabels: Record<MyReplayReason, string> = {
    created: t.myReplays.reasons.created,
    played: t.myReplays.reasons.played,
    commented: t.myReplays.reasons.commented,
    reviewed: t.myReplays.reasons.reviewed,
  };
  const reasonColors: Record<MyReplayReason, string> = {
    created: "blue",
    played: "green",
    commented: "magenta",
    reviewed: "orange",
  };
  const columnLabels: Record<MyReplayColumnKey, string> = {
    gameDate: t.myReplays.columns.gameDate,
    links: t.myReplays.columns.links,
    platform: t.myReplays.columns.platform,
    context: t.myReplays.columns.context,
    ruleset: t.myReplays.columns.ruleset,
    lastModified: t.myReplays.columns.lastModified,
    comments: t.myReplays.columns.comments,
  };
  const columnWidths = resolveMyReplayColumnWidths(columnLabels);

  const displayRuleset = (ruleset: MyReplayRuleset): string => {
    if (ruleset.id.startsWith("platform:")) {
      const source = ruleset.id.slice("platform:".length) as ReplaySource;
      return platformLabels[source] ?? ruleset.label;
    }
    if (ruleset.id === "online") {
      return t.myReplays.rulesets.online;
    }
    if (ruleset.id === "indonesian") {
      return t.myReplays.rulesets.indonesian;
    }
    return ruleset.label;
  };

  const formatDateTime = (value: number | null): string =>
    value === null
      ? t.myReplays.unknown
      : new Intl.DateTimeFormat(locale, {
          dateStyle: "medium",
          timeStyle: "short",
        }).format(value);

  const filteredGroups = useMemo(
    () => filterAndSortMyReplayGroups(groups, filters, sort),
    [filters, groups, sort]
  );
  const rows = useMemo(() => toTableRows(filteredGroups), [filteredGroups]);

  const platformOptions = useMemo(
    () =>
      [...new Set(groups.map((group) => group.source))]
        .map((source) => ({ text: platformLabels[source], value: source }))
        .sort((left, right) => left.text.localeCompare(right.text, locale)),
    [groups, locale, platformLabels]
  );
  const contextOptions = useMemo(
    () =>
      [...new Set(groups.map((group) => group.context.kind))]
        .map((context) => ({
          text: contextLabels[context],
          value: context,
        }))
        .sort((left, right) => left.text.localeCompare(right.text, locale)),
    [contextLabels, groups, locale]
  );
  const rulesetOptions = useMemo(
    () =>
      [
        ...new Map(
          groups.map((group) => [
            group.ruleset.id,
            {
              text: displayRuleset(group.ruleset),
              value: group.ruleset.id,
            },
          ])
        ).values(),
      ].sort((left, right) => left.text.localeCompare(right.text, locale)),
    [groups, locale, platformLabels, t]
  );
  const reasonOptions = REASON_DISPLAY_ORDER.map((reason) => ({
    label: reasonLabels[reason],
    value: reason,
  }));
  const hasActiveFilters =
    filters.gameDateRange !== null ||
    filters.lastModifiedRange !== null ||
    filters.platforms.length > 0 ||
    filters.reasons.length > 0 ||
    filters.contexts.length > 0 ||
    filters.rulesets.length > 0;
  const resetFilters = (): void => {
    setFilters(defaultMyReplayTablePreferences().filters);
  };
  const toggleColumn = (key: MyReplayColumnKey, checked: boolean): void => {
    setEnabledColumns((current) => {
      if (checked) {
        return MY_REPLAY_COLUMN_DISPLAY_ORDER.filter(
          (column) => column === key || current.includes(column)
        );
      }
      if (current.length === 1) {
        return current;
      }
      return current.filter((column) => column !== key);
    });
  };

  const dateFilter =
    (
      value: [number, number] | null,
      onChange: (next: [number, number] | null) => void
    ) =>
    ({ confirm }: FilterDropdownProps) => (
      <DateRangeFilter
        value={value}
        startLabel={t.myReplays.filters.startDate}
        endLabel={t.myReplays.filters.endDate}
        resetLabel={t.myReplays.filters.reset}
        applyLabel={t.myReplays.filters.apply}
        onChange={onChange}
        onClose={() => confirm({ closeDropdown: true })}
      />
    );

  const allColumns: TableColumnsType<MyReplayTableRow> = [
    {
      title: <ColumnHeaderText label={columnLabels.gameDate} />,
      dataIndex: "gameDate",
      key: "gameDate",
      width: columnWidths.gameDate,
      sorter: true,
      sortOrder: sort.field === "gameDate" ? sort.order : null,
      filteredValue: filters.gameDateRange ? ["active"] : null,
      filterDropdown: dateFilter(filters.gameDateRange, (gameDateRange) =>
        setFilters((current) => ({ ...current, gameDateRange }))
      ),
      filterIcon: (filtered) => (
        <CalendarOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
      ),
      onFilter: () => true,
      render: (value: number | null, row) => (
        <span
          style={{
            display: "flex",
            alignItems: "center",
            minWidth: 0,
            height: "100%",
          }}
        >
          {row.treeBranch ? (
            <ReplayTreeBranch position={row.treeBranch} />
          ) : null}
          <span style={{ minWidth: 0, flex: "1 1 auto" }}>
            <DateTimeText value={formatDateTime(value)} />
          </span>
        </span>
      ),
    },
    {
      title: <ColumnHeaderText label={columnLabels.links} />,
      key: "links",
      width: columnWidths.links,
      render: (_value, row) => {
        const link = myReplayLinkForRow(row);
        if (link.kind === "review") {
          const label = reviewLinkLabel(
            t.myReplays.links.reviewOf,
            link.reviewedPlayerName,
            t.myReplays.unknown
          );
          return (
            <Link
              to={link.url}
              title={label}
              style={{
                display: "inline-flex",
                alignItems: "center",
                gap: 4,
                maxWidth: "100%",
              }}
            >
              <CommentOutlined style={{ flex: "0 0 auto" }} />
              <span
                style={{
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {label}
              </span>
            </Link>
          );
        }
        return (
          <Link
            to={link.url}
            style={{ display: "inline-flex", alignItems: "center", gap: 4 }}
          >
            <EyeOutlined />
            {t.myReplays.links.replay}
          </Link>
        );
      },
    },
    {
      title: <ColumnHeaderText label={columnLabels.platform} />,
      dataIndex: "source",
      key: "platform",
      width: columnWidths.platform,
      filters: platformOptions,
      filteredValue: filters.platforms,
      onFilter: () => true,
      render: (source: ReplaySource) => (
        <PlatformCell source={source} label={platformLabels[source]} />
      ),
    },
    {
      title: <ColumnHeaderText label={columnLabels.context} />,
      dataIndex: ["context", "kind"],
      key: "context",
      width: columnWidths.context,
      filters: [
        ...REASON_DISPLAY_ORDER.map((reason) => ({
          text: `${t.myReplays.columns.reason}: ${reasonLabels[reason]}`,
          value: myReplayReasonFilterValue(reason),
        })),
        ...contextOptions.map(({ text, value }) => ({
          text: `${t.myReplays.columns.context}: ${text}`,
          value: myReplayContextFilterValue(value),
        })),
      ],
      filteredValue: [
        ...filters.reasons.map(myReplayReasonFilterValue),
        ...filters.contexts.map(myReplayContextFilterValue),
      ],
      onFilter: () => true,
      render: (_value: string, row) => (
        <Space direction="vertical" size={2}>
          <Space size={[4, 4]} wrap>
            {row.reasons.map((reason) => (
              <Tag
                key={reason}
                color={reasonColors[reason]}
                style={{ margin: 0 }}
              >
                {reasonLabels[reason]}
              </Tag>
            ))}
            <Tag
              color={
                row.context.kind === "friendly"
                  ? "green"
                  : row.context.kind === "tournament"
                    ? "gold"
                    : "blue"
              }
              style={{ margin: 0 }}
            >
              {contextLabels[row.context.kind]}
            </Tag>
          </Space>
          {row.context.tournamentName && row.context.tournamentUrl ? (
            <Link to={row.context.tournamentUrl}>
              {row.context.tournamentName}
            </Link>
          ) : row.context.tournamentName ? (
            <Typography.Text type="secondary">
              {row.context.tournamentName}
            </Typography.Text>
          ) : null}
        </Space>
      ),
    },
    {
      title: <ColumnHeaderText label={columnLabels.ruleset} />,
      dataIndex: ["ruleset", "id"],
      key: "ruleset",
      width: columnWidths.ruleset,
      filters: rulesetOptions,
      filteredValue: filters.rulesets,
      onFilter: () => true,
      render: (_value: string, row) => displayRuleset(row.ruleset),
    },
    {
      title: <ColumnHeaderText label={columnLabels.lastModified} />,
      dataIndex: "lastModified",
      key: "lastModified",
      width: columnWidths.lastModified,
      sorter: true,
      sortOrder: sort.field === "lastModified" ? sort.order : null,
      filteredValue: filters.lastModifiedRange ? ["active"] : null,
      filterDropdown: dateFilter(
        filters.lastModifiedRange,
        (lastModifiedRange) =>
          setFilters((current) => ({ ...current, lastModifiedRange }))
      ),
      filterIcon: (filtered) => (
        <CalendarOutlined style={{ color: filtered ? "#1677ff" : undefined }} />
      ),
      onFilter: () => true,
      render: (value: number | null) =>
        value === null ? null : <DateTimeText value={formatDateTime(value)} />,
    },
    {
      title: <ColumnHeaderText label={columnLabels.comments} />,
      dataIndex: "commentCount",
      key: "comments",
      align: "right",
      width: columnWidths.comments,
    },
  ];

  const hasExpandableRows = rows.some((row) => Boolean(row.children?.length));
  const fittedColumnKeys = fitMyReplayColumns(
    enabledColumns,
    containerWidth,
    hasExpandableRows,
    columnWidths
  );
  const columns = fittedColumnKeys.map((key) =>
    allColumns.find((column) => column.key === key)!
  );

  const onTableChange: TableProps<MyReplayTableRow>["onChange"] = (
    _pagination,
    tableFilters,
    sorter
  ) => {
    setFilters((current) => mergeMyReplayHeaderFilters(current, tableFilters));
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    if (
      activeSorter.field === "gameDate" ||
      activeSorter.field === "lastModified"
    ) {
      setSort(
        activeSorter.order
          ? { field: activeSorter.field, order: activeSorter.order }
          : DEFAULT_MY_REPLAY_SORT
      );
    }
  };

  const selectStyle = {
    flex: "1 1 160px",
    minWidth: 140,
    maxWidth: 240,
  } as const;

  return (
    <>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          alignItems: "center",
          gap: 8,
          marginBottom: 12,
        }}
      >
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          aria-label={t.myReplays.columns.platform}
          placeholder={t.myReplays.columns.platform}
          value={filters.platforms}
          style={selectStyle}
          options={platformOptions.map(({ text, value }) => ({
            label: text,
            value,
          }))}
          onChange={(platforms) =>
            setFilters((current) => ({ ...current, platforms }))
          }
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          aria-label={t.myReplays.columns.context}
          placeholder={t.myReplays.columns.context}
          value={filters.contexts}
          style={selectStyle}
          options={contextOptions.map(({ text, value }) => ({
            label: text,
            value,
          }))}
          onChange={(contexts) =>
            setFilters((current) => ({ ...current, contexts }))
          }
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          aria-label={t.myReplays.columns.ruleset}
          placeholder={t.myReplays.columns.ruleset}
          value={filters.rulesets}
          style={selectStyle}
          options={rulesetOptions.map(({ text, value }) => ({
            label: text,
            value,
          }))}
          onChange={(rulesets) =>
            setFilters((current) => ({ ...current, rulesets }))
          }
        />
        <Select
          mode="multiple"
          allowClear
          maxTagCount="responsive"
          aria-label={t.myReplays.columns.reason}
          placeholder={t.myReplays.columns.reason}
          value={filters.reasons}
          style={selectStyle}
          options={reasonOptions}
          onChange={(reasons) =>
            setFilters((current) => ({
              ...current,
              reasons: reasons as MyReplayReason[],
            }))
          }
        />
        <DateRangeControl
          label={t.myReplays.columns.gameDate}
          value={filters.gameDateRange}
          startLabel={t.myReplays.filters.startDate}
          endLabel={t.myReplays.filters.endDate}
          resetLabel={t.myReplays.filters.reset}
          applyLabel={t.myReplays.filters.apply}
          onChange={(gameDateRange) =>
            setFilters((current) => ({ ...current, gameDateRange }))
          }
        />
        <DateRangeControl
          label={t.myReplays.columns.lastModified}
          value={filters.lastModifiedRange}
          startLabel={t.myReplays.filters.startDate}
          endLabel={t.myReplays.filters.endDate}
          resetLabel={t.myReplays.filters.reset}
          applyLabel={t.myReplays.filters.apply}
          onChange={(lastModifiedRange) =>
            setFilters((current) => ({ ...current, lastModifiedRange }))
          }
        />
        <Popover
          trigger="click"
          placement="bottomRight"
          content={
            <Space direction="vertical" size={8} style={{ minWidth: 180 }}>
              {MY_REPLAY_COLUMN_DISPLAY_ORDER.map((key) => (
                <Checkbox
                  key={key}
                  checked={enabledColumns.includes(key)}
                  disabled={
                    enabledColumns.length === 1 && enabledColumns.includes(key)
                  }
                  onChange={(event) => toggleColumn(key, event.target.checked)}
                >
                  {columnLabels[key]}
                </Checkbox>
              ))}
              <Button
                type="link"
                size="small"
                onClick={() =>
                  setEnabledColumns([...MY_REPLAY_COLUMN_DISPLAY_ORDER])
                }
              >
                {t.myReplays.filters.showAllColumns}
              </Button>
            </Space>
          }
        >
          <Button icon={<TableOutlined />}>
            {t.myReplays.filters.columns}
          </Button>
        </Popover>
        <Button
          icon={<ClearOutlined />}
          disabled={!hasActiveFilters}
          onClick={resetFilters}
        >
          {t.myReplays.filters.clearAll}
        </Button>
      </div>
      <div ref={tableContainerRef} style={{ width: "100%", minWidth: 0 }}>
        <Table<MyReplayTableRow>
          dataSource={rows}
          columns={columns}
          rowKey="key"
          tableLayout="fixed"
          defaultExpandAllRows
          expandable={
            hasExpandableRows
              ? {
                  rowExpandable: (row) => Boolean(row.children?.length),
                }
              : undefined
          }
          pagination={{
            pageSize,
            pageSizeOptions: [10, 20, 50, 100],
            showSizeChanger: true,
            onChange: (_page, nextPageSize) => setPageSize(nextPageSize),
            showTotal: (total) =>
              t.myReplays.total.replace("{count}", String(total)),
          }}
          locale={{
            emptyText: <Empty description={t.myReplays.noMatches} />,
          }}
          onChange={onTableChange}
        />
      </div>
    </>
  );
}
