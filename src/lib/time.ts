const UNITS: { label: string; seconds: number }[] = [
  { label: "y", seconds: 60 * 60 * 24 * 365 },
  { label: "mo", seconds: 60 * 60 * 24 * 30 },
  { label: "w", seconds: 60 * 60 * 24 * 7 },
  { label: "d", seconds: 60 * 60 * 24 },
  { label: "h", seconds: 60 * 60 },
  { label: "m", seconds: 60 },
];

export function formatRelativeTime(iso: string, now: Date = new Date()): string {
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return "";
  const diffSeconds = Math.round((now.getTime() - then) / 1000);
  const abs = Math.abs(diffSeconds);
  if (abs < 45) return "just now";
  for (const unit of UNITS) {
    if (abs >= unit.seconds) {
      const value = Math.round(abs / unit.seconds);
      return diffSeconds >= 0 ? `${value}${unit.label} ago` : `in ${value}${unit.label}`;
    }
  }
  return "just now";
}
