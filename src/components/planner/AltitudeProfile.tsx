/**
 * @module AltitudeProfile
 * @description Altitude profile chart for the planner dock. Plots waypoint
 * altitude vs cumulative ground distance using recharts, filling its parent's
 * height. Waypoint dots are clickable to select the waypoint.
 * @license GPL-3.0-only
 */
"use client";

import { useMemo } from "react";
import { AreaChart, Area, XAxis, YAxis, ResponsiveContainer, Dot } from "recharts";
import type { Waypoint } from "@/lib/types";
import { cumulativeGroundDistances } from "@/lib/altitude-profile";
import { MAP_COLORS } from "@/lib/map-constants";
import { useSettingsStore } from "@/stores/settings-store";
import { formatDistance, formatAltitude } from "@/lib/units/format";

/** Data point for the altitude profile chart. */
interface AltitudeDataPoint {
  id: string;
  distance: number;
  alt: number;
  label: string;
}

interface AltitudeProfileProps {
  waypoints: Waypoint[];
  selectedWaypointId: string | null;
  onSelectWaypoint: (id: string) => void;
}

export function AltitudeProfile({
  waypoints,
  selectedWaypointId,
  onSelectWaypoint,
}: AltitudeProfileProps) {
  const units = useSettingsStore((s) => s.units);
  const data: AltitudeDataPoint[] = useMemo(() => {
    const distances = cumulativeGroundDistances(waypoints);
    return waypoints.map((wp, i) => {
      const cumDist = distances[i];
      return {
        id: wp.id,
        distance: Math.round(cumDist),
        alt: wp.alt,
        label: `WP${i + 1}`,
      };
    });
  }, [waypoints]);

  if (waypoints.length === 0) return null;

  return (
    <div className="h-full min-h-0">
      <ResponsiveContainer width="100%" height="100%">
        <AreaChart data={data} margin={{ top: 4, right: 8, bottom: 0, left: 0 }}>
          <defs>
            <linearGradient id="altGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={MAP_COLORS.accentPrimary} stopOpacity={0.3} />
              <stop offset="100%" stopColor={MAP_COLORS.accentPrimary} stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <XAxis
            dataKey="distance"
            tick={{ fill: "var(--alt-text-tertiary)", fontSize: 11, fontFamily: "JetBrains Mono" }}
            axisLine={{ stroke: "var(--alt-border-default)" }}
            tickLine={false}
            tickFormatter={(v) => formatDistance(Number(v), units)}
          />
          <YAxis
            tick={{ fill: "var(--alt-text-tertiary)", fontSize: 11, fontFamily: "JetBrains Mono" }}
            axisLine={false}
            tickLine={false}
            width={44}
            tickFormatter={(v) => formatAltitude(Number(v), units)}
          />
          <Area
            type="monotone"
            dataKey="alt"
            stroke={MAP_COLORS.accentPrimary}
            strokeWidth={1.5}
            fill="url(#altGrad)"
            dot={(props) => {
              const { cx, cy, payload } = props as { cx: number; cy: number; payload: AltitudeDataPoint };
              const isSelected = payload.id === selectedWaypointId;
              return (
                <Dot
                  key={payload.id}
                  cx={cx}
                  cy={cy}
                  r={isSelected ? 5 : 3}
                  fill={isSelected ? MAP_COLORS.accentPrimary : MAP_COLORS.foreground}
                  stroke={MAP_COLORS.accentPrimary}
                  strokeWidth={1.5}
                  style={{ cursor: "pointer" }}
                  onClick={() => onSelectWaypoint(payload.id)}
                />
              );
            }}
            activeDot={false}
          />
        </AreaChart>
      </ResponsiveContainer>
    </div>
  );
}
