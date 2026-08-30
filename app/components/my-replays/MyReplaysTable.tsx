import { useMemo, useState } from "react";
import { Button, Empty, Input, Space, Table, Tag, Typography } from "antd";
import type { TableColumnsType, TableProps } from "antd";
import type { FilterDropdownProps, FilterValue } from "antd/es/table/interface";
import {
  CalendarOutlined,
  CommentOutlined,
  EyeOutlined,
} from "@ant-design/icons";
import { Link } from "react-router";
import { useLocale } from "~/contexts/LocaleContext";
import type {
  MyReplayContext,
  MyReplayContextKind,
  MyReplayGroup,
  MyReplayRuleset,
} from "~/types/myReplays";
import type { ReplaySource } from "~/game/replay/types";
import {
  DEFAULT_MY_REPLAY_SORT,
  EMPTY_MY_REPLAY_FILTERS,
  filterAndSortMyReplayGroups,
  type MyReplayFilters,
  type MyReplayRowType,
  type MyReplaySort,
} from "./myReplayRows";

interface MyReplayTableRow {
  key: string;
  rowType: MyReplayRowType;
  gameDate: number | null;
  source: ReplaySource;
  context: MyReplayContext;
  ruleset: MyReplayRuleset;
  replayUrl: string;
  reviewUrl?: string;
  lastModified: number | null;
  commentCount: number;
  children?: MyReplayTableRow[];
}

function toTableRows(groups: MyReplayGroup[]): MyReplayTableRow[] {
  return groups.map((group) => ({
    key: group.key,
    rowType: "replay",
    gameDate: group.gameDate,
    source: group.source,
    context: group.context,
    ruleset: group.ruleset,
    replayUrl: group.replayUrl,
    lastModified: null,
    commentCount: group.commentCount,
    children: group.reviews.map((review) => ({
      key: review.key,
      rowType: "review",
      gameDate: group.gameDate,
      source: group.source,
      context: group.context,
      ruleset: group.ruleset,
      replayUrl: review.replayUrl,
      reviewUrl: review.reviewUrl,
      lastModified: review.lastModified,
      commentCount: review.commentCount,
    })),
  }));
}

function stringFilterValues(value: FilterValue | null): string[] {
  return value?.map(String) ?? [];
}

function dateInputValue(timestamp: number): string {
  const date = new Date(timestamp);
  const year = String(date.getFullYear()).padStart(4, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
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

export function MyReplaysTable({ groups }: { groups: MyReplayGroup[] }) {
  const { locale, t } = useLocale();
  const [filters, setFilters] = useState<MyReplayFilters>(
    EMPTY_MY_REPLAY_FILTERS
  );
  const [sort, setSort] = useState<MyReplaySort>(DEFAULT_MY_REPLAY_SORT);

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

  const columns: TableColumnsType<MyReplayTableRow> = [
    {
      title: t.myReplays.columns.gameDate,
      dataIndex: "gameDate",
      key: "gameDate",
      width: 185,
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
      render: (value: number | null) => formatDateTime(value),
    },
    {
      title: t.myReplays.columns.platform,
      dataIndex: "source",
      key: "platform",
      width: 135,
      filters: platformOptions,
      filteredValue: filters.platforms,
      onFilter: () => true,
      render: (source: ReplaySource) => platformLabels[source],
    },
    {
      title: t.myReplays.columns.context,
      dataIndex: ["context", "kind"],
      key: "context",
      width: 175,
      filters: contextOptions,
      filteredValue: filters.contexts,
      onFilter: () => true,
      render: (_value: string, row) => (
        <Space direction="vertical" size={2}>
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
      title: t.myReplays.columns.ruleset,
      dataIndex: ["ruleset", "id"],
      key: "ruleset",
      width: 165,
      filters: rulesetOptions,
      filteredValue: filters.rulesets,
      onFilter: () => true,
      render: (_value: string, row) => displayRuleset(row.ruleset),
    },
    {
      title: t.myReplays.columns.type,
      dataIndex: "rowType",
      key: "rowType",
      width: 105,
      filters: [
        { text: t.myReplays.types.replay, value: "replay" },
        { text: t.myReplays.types.review, value: "review" },
      ],
      filteredValue: filters.rowTypes,
      onFilter: () => true,
      render: (rowType: MyReplayRowType) => (
        <Tag color={rowType === "replay" ? "cyan" : "magenta"}>
          {t.myReplays.types[rowType]}
        </Tag>
      ),
    },
    {
      title: t.myReplays.columns.links,
      key: "links",
      width: 185,
      render: (_value, row) => (
        <Space wrap>
          <Link to={row.replayUrl}>
            <EyeOutlined /> {t.myReplays.links.replay}
          </Link>
          {row.reviewUrl ? (
            <Link to={row.reviewUrl}>
              <CommentOutlined /> {t.myReplays.links.review}
            </Link>
          ) : null}
        </Space>
      ),
    },
    {
      title: t.myReplays.columns.lastModified,
      dataIndex: "lastModified",
      key: "lastModified",
      width: 185,
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
        value === null ? t.myReplays.notApplicable : formatDateTime(value),
    },
    {
      title: t.myReplays.columns.comments,
      dataIndex: "commentCount",
      key: "commentCount",
      align: "right",
      width: 115,
    },
  ];

  const onTableChange: TableProps<MyReplayTableRow>["onChange"] = (
    _pagination,
    tableFilters,
    sorter
  ) => {
    setFilters((current) => ({
      ...current,
      platforms: stringFilterValues(tableFilters.platform) as ReplaySource[],
      contexts: stringFilterValues(
        tableFilters.context
      ) as MyReplayContextKind[],
      rulesets: stringFilterValues(tableFilters.ruleset),
      rowTypes: stringFilterValues(tableFilters.rowType) as MyReplayRowType[],
    }));
    const activeSorter = Array.isArray(sorter) ? sorter[0] : sorter;
    if (
      (activeSorter.field === "gameDate" ||
        activeSorter.field === "lastModified") &&
      activeSorter.order
    ) {
      setSort({ field: activeSorter.field, order: activeSorter.order });
    } else {
      setSort(DEFAULT_MY_REPLAY_SORT);
    }
  };

  return (
    <Table<MyReplayTableRow>
      dataSource={rows}
      columns={columns}
      rowKey="key"
      defaultExpandAllRows
      expandable={{ rowExpandable: (row) => Boolean(row.children?.length) }}
      pagination={{
        defaultPageSize: 20,
        pageSizeOptions: [10, 20, 50, 100],
        showSizeChanger: true,
        showTotal: (total) =>
          t.myReplays.total.replace("{count}", String(total)),
      }}
      locale={{
        emptyText: <Empty description={t.myReplays.noMatches} />,
      }}
      scroll={{ x: 1250 }}
      onChange={onTableChange}
    />
  );
}
