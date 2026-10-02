export interface SeriesPoint {
  x: string;
  y: number;
}

export interface Series {
  id: string;
  label: string;
  color?: string;
  data: SeriesPoint[];
  eliminatedAt?: string;
}

export interface RankingSeries {
  id: string;
  data: SeriesPoint[];
}

export function isEliminatedOnDay(
  eliminatedAt: string | undefined,
  day: string
): boolean {
  return eliminatedAt !== undefined && day >= eliminatedAt;
}

export function buildRankingData(series: Series[]): RankingSeries[] {
  if (series.length < 2) {
    return [];
  }

  const allDays = new Set<string>();
  for (const item of series) {
    for (const point of item.data) {
      allDays.add(point.x);
    }
  }
  const sortedDays = [...allDays].sort();
  const seriesDayMaps = series.map((item) => {
    const values = new Map<string, number>();
    for (const point of item.data) {
      values.set(point.x, point.y);
    }
    return values;
  });

  return series.map((item, seriesIndex) => {
    const data: SeriesPoint[] = [];
    for (const day of sortedDays) {
      const scores = series
        .map((candidate, candidateIndex) => {
          let value = seriesDayMaps[candidateIndex].get(day);
          if (value === undefined) {
            for (const point of candidate.data) {
              if (point.x <= day) {
                value = point.y;
              } else {
                break;
              }
            }
          }
          if (value === undefined) {
            return null;
          }
          return {
            index: candidateIndex,
            value,
            eliminated: isEliminatedOnDay(candidate.eliminatedAt, day),
          };
        })
        .filter(
          (
            score
          ): score is {
            index: number;
            value: number;
            eliminated: boolean;
          } => score !== null
        );

      scores.sort((a, b) => {
        if (a.eliminated !== b.eliminated) {
          return a.eliminated ? 1 : -1;
        }
        return b.value - a.value;
      });
      const rank = scores.findIndex((score) => score.index === seriesIndex);
      if (rank !== -1) {
        data.push({ x: day, y: rank + 1 });
      }
    }
    return { id: item.label, data };
  });
}
