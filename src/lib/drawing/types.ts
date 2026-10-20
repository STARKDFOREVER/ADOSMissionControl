/**
 * @module drawing/types
 * @description Type definitions for the map drawing tools (polygon, circle, measure).
 * @license GPL-3.0-only
 */

export interface DrawnPolygon {
  id: string;
  vertices: [number, number][]; // [lat, lon]
  area: number; // square meters
}

export interface DrawnCircle {
  id: string;
  center: [number, number]; // [lat, lon]
  radius: number; // meters
}

export interface MeasureLine {
  points: [number, number][]; // [lat, lon]
  totalDistance: number; // meters
  segmentDistances: number[]; // meters per segment
}

export interface DrawnPolyline {
  id: string;
  points: [number, number][]; // [lat, lon], open (first and last differ)
}

export type DrawingMode = "polygon" | "polyline" | "circle" | "measure" | null;
