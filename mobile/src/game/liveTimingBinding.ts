export function refreshNativeTiming(
  online: { refreshClock(): void } | null,
  nearby: { refreshClock(): void } | null
): void {
  online?.refreshClock();
  nearby?.refreshClock();
}
