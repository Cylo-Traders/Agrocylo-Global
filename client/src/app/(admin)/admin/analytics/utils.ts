export function downloadFile(filename: string, content: string, mime: string) {
  const blob = new Blob([content], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export function buildDailySeries(
  events: Array<{ timestamp: string; name: string }>,
  days = 7,
) {
  const map = new Map<string, number>();
  const now = new Date();

  for (let i = days - 1; i >= 0; i -= 1) {
    const day = new Date(now);
    day.setDate(now.getDate() - i);
    map.set(day.toISOString().slice(0, 10), 0);
  }

  for (const event of events) {
    const key = event.timestamp.slice(0, 10);
    if (map.has(key)) {
      map.set(key, (map.get(key) ?? 0) + 1);
    }
  }

  return Array.from(map.entries()).map(([day, value]) => ({
    day,
    label: new Date(`${day}T00:00:00`).toLocaleDateString("en-US", {
      month: "short",
      day: "numeric",
    }),
    value,
  }));
}

export function formatPercent(value: number) {
  return `${Math.round(value * 100)}%`;
}
