/**
 * Replace positional placeholders {0}, {1}, {2}… in a template string.
 *
 * Example:
 *   formatString("**{0}.** {1} - {2} ({3} games)", "1", "TeamA", "42", "5")
 *   → "**1.** TeamA - 42 (5 games)"
 */
export function formatString(template: string, ...args: string[]): string {
  return template.replace(/\{(\d+)\}/g, (match, index) => {
    const i = Number(index);
    return i < args.length ? args[i] : match;
  });
}
