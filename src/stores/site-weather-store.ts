/**
 * @module site-weather-store
 * @description The last weather report the planner's Site tab showed, so the
 * pattern editor can default its wind alignment to the forecast without a
 * second fetch. In memory only; null until the Site tab has a report.
 * @license GPL-3.0-only
 */

import { create } from "zustand";
import type { WeatherReport } from "@/lib/weather/open-meteo";

interface SiteWeatherState {
  report: WeatherReport | null;
  setReport: (report: WeatherReport | null) => void;
}

export const useSiteWeatherStore = create<SiteWeatherState>()((set) => ({
  report: null,
  setReport: (report) => set({ report }),
}));
