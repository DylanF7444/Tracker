import { useEffect, useMemo, useRef, useState } from "react";
import type { TimelineRow, TimelineSegment } from "../types";

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

const SOURCE_LABELS: Record<string, string> = {
  "desktop-window": "Desktop",
  "browser-tab": "Browser",
  "mobile-usage": "Mobile",
  "manual-tag": "Manual"
};

const SOURCE_ORDER = ["desktop-window", "browser-tab", "mobile-usage", "manual-tag"];

function toDayStart(ts: string): number {
  const date = new Date(ts);
  date.setHours(0, 0, 0, 0);
  return date.getTime();
}

function minutesBetween(startTs: string, endTs: string): number {
  return Math.max(0, Math.round((new Date(endTs).getTime() - new Date(startTs).getTime()) / 60000));
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

function toMs(ts: string): number {
  return new Date(ts).getTime();
}

function sourceRank(source: string): number {
  const index = SOURCE_ORDER.indexOf(source);
  return index >= 0 ? index : SOURCE_ORDER.length + 1;
}

function getDomain(pageUrl: string): string {
  if (!pageUrl) return "";
  try {
    return new URL(pageUrl).hostname;
  } catch {
    return "";
  }
}

function getFaviconUrl(segment: TimelineSegment): string | null {
  const domain = getDomain(segment.pageUrl);
  if (!domain) return null;
  return `https://www.google.com/s2/favicons?domain=${encodeURIComponent(domain)}&sz=64`;
}

function getFallbackIcon(segment: TimelineSegment): string {
  const text = segment.label.toLowerCase();
  if (segment.source === "mobile-usage") return "📱";
  if (segment.source === "browser-tab") return "🌐";
  if (text.includes("code") || text.includes("studio")) return "💻";
  if (text.includes("terminal") || text.includes("powershell") || text.includes("cmd")) return "⌨️";
  if (text.includes("slack") || text.includes("teams") || text.includes("zoom")) return "💬";
  if (text.includes("youtube") || text.includes("netflix")) return "🎬";
  if (text.includes("spotify")) return "🎵";
  return "🧩";
}

type TimelineRowTrackProps = {
  row: TimelineRow;
  selectedSegmentId?: string;
  zoomLevel?: number;
  expanded?: boolean;
  onSelectSegment?: (segment: TimelineSegment, row: TimelineRow) => void;
};

export function TimelineRowTrack({
  row,
  selectedSegmentId,
  zoomLevel = 1,
  expanded = false,
  onSelectSegment
}: TimelineRowTrackProps) {
  const [brokenIcons, setBrokenIcons] = useState<Record<string, boolean>>({});
  const segmentRefs = useRef<Record<string, HTMLButtonElement | null>>({});
  const normalizedZoomLevel = Math.max(1, zoomLevel);

  const sourceBreakdown = useMemo(() => {
    const map = new Map<string, number>();
    for (const segment of row.segments) {
      map.set(segment.source, (map.get(segment.source) ?? 0) + minutesBetween(segment.startTs, segment.endTs));
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]);
  }, [row.segments]);

  const segmentsBySource = useMemo(() => {
    const grouped = new Map<string, TimelineSegment[]>();
    for (const segment of row.segments) {
      const list = grouped.get(segment.source) ?? [];
      list.push(segment);
      grouped.set(segment.source, list);
    }
    return [...grouped.entries()]
      .sort((a, b) => sourceRank(a[0]) - sourceRank(b[0]) || a[0].localeCompare(b[0]))
      .map(([source, segments]) => {
        const sorted = [...segments].sort(
          (a, b) => toMs(a.startTs) - toMs(b.startTs) || toMs(b.endTs) - toMs(a.endTs) || a.id.localeCompare(b.id)
        );
        const tracks: TimelineSegment[][] = [];
        const trackEnds: number[] = [];

        for (const segment of sorted) {
          const startMs = toMs(segment.startTs);
          const endMs = toMs(segment.endTs);
          let placed = false;

          for (let index = 0; index < tracks.length; index += 1) {
            if (startMs >= trackEnds[index]) {
              tracks[index].push(segment);
              trackEnds[index] = endMs;
              placed = true;
              break;
            }
          }

          if (!placed) {
            tracks.push([segment]);
            trackEnds.push(endMs);
          }
        }

        return {
          source,
          tracks
        };
      });
  }, [row.segments]);

  useEffect(() => {
    if (!selectedSegmentId) {
      return;
    }
    const selectedElement = segmentRefs.current[selectedSegmentId];
    if (!selectedElement) {
      return;
    }
    selectedElement.scrollIntoView({
      behavior: "smooth",
      block: "nearest",
      inline: "center"
    });
  }, [expanded, normalizedZoomLevel, selectedSegmentId]);

  return (
    <div className={`timeline-row ${expanded ? "expanded" : ""}`}>
      <div className="timeline-row-label">
        <strong>
          {row.deviceType} · {row.deviceId}
        </strong>
        <div className="timeline-row-usage">
          {sourceBreakdown.map(([source, minutes]) => (
            <span key={source} className="timeline-row-usage-pill">
              {SOURCE_LABELS[source] ?? source}: {minutes}m
            </span>
          ))}
        </div>
      </div>
      <div className="timeline-lanes">
        <div className="timeline-lanes-scroll">
          <div className="timeline-lanes-zoom" style={{ width: `${normalizedZoomLevel * 100}%` }}>
            {segmentsBySource.map(({ source, tracks }) => (
              <div key={source} className="timeline-lane">
                <div className="timeline-lane-label-wrap">
                  <div className="timeline-lane-label">{SOURCE_LABELS[source] ?? source}</div>
                  {tracks.length > 1 ? <span className="timeline-overlap-badge">{tracks.length} stacks</span> : null}
                </div>
                <div className="timeline-track-stack">
                  {tracks.map((track, trackIndex) => (
                    <div key={`${source}-track-${trackIndex}`} className="timeline-track-row">
                      {track.map((segment) => {
                        const { left, width } = toPercent(segment.startTs, segment.endTs);
                        const faviconUrl = getFaviconUrl(segment);
                        const canShowFavicon = !!faviconUrl && !brokenIcons[segment.id];
                        return (
                          <button
                            type="button"
                            key={segment.id}
                            ref={(element) => {
                              segmentRefs.current[segment.id] = element;
                            }}
                            className={`timeline-segment ${selectedSegmentId === segment.id ? "selected" : ""}`}
                            style={{
                              left: `${left}%`,
                              width: `${width}%`,
                              backgroundColor: CATEGORY_COLORS[segment.category] ?? "#bdbdbd"
                            }}
                            title={`${segment.label} · ${SOURCE_LABELS[segment.source] ?? segment.source} (${new Date(
                              segment.startTs
                            ).toLocaleTimeString()} - ${new Date(segment.endTs).toLocaleTimeString()})`}
                            onClick={() => onSelectSegment?.(segment, row)}
                          >
                            <span className="timeline-segment-icon" aria-hidden="true">
                              {canShowFavicon ? (
                                <img
                                  src={faviconUrl}
                                  alt=""
                                  onError={() =>
                                    setBrokenIcons((prev) => ({
                                      ...prev,
                                      [segment.id]: true
                                    }))
                                  }
                                />
                              ) : (
                                <span>{getFallbackIcon(segment)}</span>
                              )}
                            </span>
                          </button>
                        );
                      })}
                    </div>
                  ))}
                </div>
              </div>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
