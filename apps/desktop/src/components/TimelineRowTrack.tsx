import type { TimelineRow } from "../types";

const CATEGORY_COLORS: Record<string, string> = {
  productivity: "#4caf50",
  communication: "#2f80ed",
  entertainment: "#eb5757",
  distracting: "#f2994a",
  meeting: "#9b51e0",
  break: "#56ccf2",
  neutral: "#828282",
  system: "#bdbdbd"
};

function toDayStart(ts: string): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function toPercent(startTs: string, endTs: string): { left: number; width: number } {
  const dayStart = toDayStart(startTs);
  const fullDay = 24 * 60 * 60 * 1000;
  const start = new Date(startTs).getTime();
  const end = new Date(endTs).getTime();
  const left = ((start - dayStart) / fullDay) * 100;
  const width = Math.max(0.5, ((end - start) / fullDay) * 100);
  return { left, width };
}

export function TimelineRowTrack({ row }: { row: TimelineRow }) {
  return (
    <div className="timeline-row">
      <div className="timeline-row-label">
        <span>{row.deviceType}</span>
        <span>{row.deviceId}</span>
      </div>
      <div className="timeline-track">
        {row.segments.map((segment) => {
          const { left, width } = toPercent(segment.startTs, segment.endTs);
          return (
            <button
              type="button"
              key={segment.id}
              className="timeline-segment"
              style={{
                left: `${left}%`,
                width: `${width}%`,
                backgroundColor: CATEGORY_COLORS[segment.category] ?? "#bdbdbd"
              }}
              title={`${segment.label} (${new Date(segment.startTs).toLocaleTimeString()} - ${new Date(
                segment.endTs
              ).toLocaleTimeString()})`}
            >
              <span>{segment.label}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
