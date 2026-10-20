/**
 * @module home-icon
 * @description Home marker icons shared by the flight map and the planner map:
 * the vehicle's reported home, the plan's planned home ("H"), and the faint
 * outlined house the planner draws where the vehicle reports a different home.
 * @license GPL-3.0-only
 */

import L from "leaflet";
import { MAP_COLORS } from "@/lib/map-constants";

const HOME_RING = `<circle cx="10" cy="10" r="8" fill="none" stroke="${MAP_COLORS.accentPrimary}" stroke-width="1.5" stroke-dasharray="4 3" />`;

/** The vehicle's reported home: a dashed ring around a dot. */
export const homeIcon: L.DivIcon = L.divIcon({
  className: "",
  iconSize: [20, 20],
  iconAnchor: [10, 10],
  html: `<svg width="20" height="20" viewBox="0 0 20 20">
      ${HOME_RING}
      <circle cx="10" cy="10" r="3" fill="${MAP_COLORS.accentPrimary}" fill-opacity="0.6" />
    </svg>`,
});

/** The plan's planned home: the home ring around an "H". */
export const plannedHomeIcon: L.DivIcon = L.divIcon({
  className: "",
  iconSize: [24, 24],
  iconAnchor: [12, 12],
  html: `<svg width="24" height="24" viewBox="-2 -2 24 24">
      <circle cx="10" cy="10" r="10" fill="${MAP_COLORS.background}" fill-opacity="0.7" />
      ${HOME_RING}
      <text x="10" y="14" text-anchor="middle" fill="${MAP_COLORS.accentPrimary}" font-size="11" font-family="JetBrains Mono, monospace" font-weight="700">H</text>
    </svg>`,
});

/** Where the vehicle reports a home other than the planned one: an outlined house at half opacity. */
export const vehicleHomeGhostIcon: L.DivIcon = L.divIcon({
  className: "",
  iconSize: [22, 22],
  iconAnchor: [11, 11],
  html: `<svg width="22" height="22" viewBox="0 0 22 22" style="opacity:0.5">
      <path d="M3 11 L11 4 L19 11 M5.5 9 V18 H16.5 V9" fill="none" stroke="${MAP_COLORS.foreground}" stroke-width="1.6" stroke-linejoin="round" stroke-linecap="round" />
    </svg>`,
});
