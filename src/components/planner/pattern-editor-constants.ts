/**
 * @module pattern-editor-constants
 * @description Constants and option arrays for the PatternEditor component.
 * @license GPL-3.0-only
 */

import { CAMERA_PROFILES } from "@/lib/patterns/gsd-calculator";

export const PATTERN_TYPE_OPTIONS = [
  { value: "survey", label: "Survey grid", description: "Grid/lawnmower pattern for area coverage and mapping" },
  { value: "orbit", label: "Orbit", description: "Circular flight around a point of interest" },
  { value: "corridor", label: "Corridor", description: "Lines flown along a path, covering its width" },
  { value: "facade", label: "Facade", description: "Vertical rows in front of one wall" },
  { value: "perimeter", label: "Perimeter", description: "One closed loop around a boundary, optionally inset" },
  { value: "expandingSquare", label: "SAR: expanding square", description: "Search pattern expanding outward from a datum point" },
  { value: "sectorSearch", label: "SAR: sector search", description: "Pie-slice search radiating from a datum point" },
  { value: "parallelTrack", label: "SAR: parallel track", description: "Systematic parallel sweeps across a search area" },
  { value: "structureScan", label: "Structure scan", description: "Multi-layer orbit for 3D structure inspection" },
  { value: "fixedWingLanding", label: "Fixed-wing landing", description: "Straight-in approach and landing sequence for a fixed-wing aircraft" },
  { value: "vtolLanding", label: "VTOL landing", description: "Cruise approach, transition, and vertical landing for a VTOL aircraft" },
];

export const ENTRY_LOCATION_OPTIONS: { value: "topLeft" | "topRight" | "bottomLeft" | "bottomRight"; label: string }[] = [
  { value: "topLeft", label: "Top left" },
  { value: "topRight", label: "Top right" },
  { value: "bottomLeft", label: "Bottom left" },
  { value: "bottomRight", label: "Bottom right" },
];

export const SCAN_DIRECTION_OPTIONS: { value: "bottom-up" | "top-down"; label: string }[] = [
  { value: "bottom-up", label: "Bottom up" },
  { value: "top-down", label: "Top down" },
];

export const CAMERA_OPTIONS = [
  { value: "", label: "Manual" },
  ...CAMERA_PROFILES.map((c) => ({ value: c.name, label: c.name })),
];

export const VALID_PATTERN_TYPES = new Set(PATTERN_TYPE_OPTIONS.map((o) => o.value));

export interface SurveyPreset {
  label: string;
  sidelap: number;
  frontlap: number;
  altitude: number;
  speed: number;
  tieLines?: boolean;
  description: string;
}

export const SURVEY_PRESETS: SurveyPreset[] = [
  { label: "Photogrammetry Standard", sidelap: 70, frontlap: 80, altitude: 50, speed: 5, description: "Most common mapping preset" },
  { label: "High Detail", sidelap: 90, frontlap: 80, altitude: 30, speed: 3, description: "Dense 3D reconstruction" },
  { label: "Quick Overview", sidelap: 60, frontlap: 75, altitude: 80, speed: 8, description: "Fast area coverage" },
  { label: "Inspection", sidelap: 70, frontlap: 60, altitude: 30, speed: 2, description: "Close-range inspection" },
  { label: "Magnetic Survey", sidelap: 60, frontlap: 50, altitude: 50, speed: 5, tieLines: true, description: "Tie lines enabled for calibration" },
];

export const SURVEY_PRESET_OPTIONS = [
  { value: "", label: "Custom" },
  ...SURVEY_PRESETS.map((p) => ({ value: p.label, label: p.label, description: p.description })),
];
