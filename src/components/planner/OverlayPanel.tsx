/**
 * @module OverlayPanel
 * @description Slide-out panel for managing KML/KMZ overlay files.
 * Upload, toggle visibility, adjust opacity, and remove overlays.
 * @license GPL-3.0-only
 */
"use client";

import { useRef, useCallback, useState } from "react";
import { useTranslations } from "next-intl";
import { useOverlayStore, type KmlOverlay } from "@/stores/overlay-store";
import { RasterImportControl } from "@/components/planner/RasterImportControl";
import { parseKML } from "@/lib/formats/kml-parser";
import { parseKMZ } from "@/lib/formats/kmz-handler";
import { X, Eye, EyeOff, Trash2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { FloatingPanel } from "@/components/ui/floating-panel";
import { randomId } from "@/lib/utils";

interface OverlayPanelProps {
  onClose: () => void;
}

export function OverlayPanel({ onClose }: OverlayPanelProps) {
  const overlays = useOverlayStore((s) => s.overlays);
  const addOverlay = useOverlayStore((s) => s.addOverlay);
  const removeOverlay = useOverlayStore((s) => s.removeOverlay);
  const toggleVisibility = useOverlayStore((s) => s.toggleVisibility);
  const setOpacity = useOverlayStore((s) => s.setOpacity);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const t = useTranslations("planner.overlays");

  const [parseError, setParseError] = useState<"noGeometry" | "parseFailed" | null>(null);

  const handleFileSelect = useCallback(
    async (e: React.ChangeEvent<HTMLInputElement>) => {
      const file = e.target.files?.[0];
      if (!file) return;
      setParseError(null);

      try {
        const result = file.name.endsWith(".kmz")
          ? await parseKMZ(file)
          : parseKML(await file.text());

        if (result.polygons.length === 0 && result.paths.length === 0 && result.points.length === 0) {
          setParseError("noGeometry");
          return;
        }

        const overlay: KmlOverlay = {
          id: randomId(),
          name: result.name || file.name.replace(/\.(kml|kmz)$/i, ""),
          visible: true,
          opacity: 0.7,
          polygons: result.polygons,
          paths: result.paths,
          points: result.points,
          style: {
            lineColor: result.style.lineColor,
            fillColor: result.style.fillColor,
            lineWidth: result.style.lineWidth,
          },
        };

        addOverlay(overlay);
      } catch (err) {
        console.error("Failed to parse KML/KMZ:", err);
        setParseError("parseFailed");
      }

      // Reset input so the same file can be re-selected
      if (fileInputRef.current) fileInputRef.current.value = "";
    },
    [addOverlay],
  );

  return (
    <FloatingPanel layer="popover" padded={false} className="top-24 left-14 w-64 overflow-hidden">
      {/* Header */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-border-default">
        <span className="text-[11px] font-body font-semibold text-text-primary">
          {t("title")}
        </span>
        <button
          onClick={onClose}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          aria-label={t("close")}
        >
          <X size={12} />
        </button>
      </div>

      {/* Overlay list */}
      <div className="max-h-[280px] overflow-y-auto">
        {overlays.length === 0 ? (
          <div className="px-3 py-4 text-center">
            <p className="text-[11px] text-text-tertiary">
              {t("empty")}
            </p>
          </div>
        ) : (
          <div className="flex flex-col">
            {overlays.map((overlay) => (
              <OverlayItem
                key={overlay.id}
                overlay={overlay}
                onToggle={() => toggleVisibility(overlay.id)}
                onRemove={() => removeOverlay(overlay.id)}
                onOpacityChange={(v) => setOpacity(overlay.id, v)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Error */}
      {parseError && (
        <div className="px-3 py-1.5 bg-status-error/10 border-t border-status-error/30">
          <span className="text-[11px] text-status-error">{t(parseError)}</span>
        </div>
      )}

      {/* Add button */}
      <div className="px-3 py-2 border-t border-border-default">
        <input
          ref={fileInputRef}
          type="file"
          accept=".kml,.kmz"
          onChange={handleFileSelect}
          className="hidden"
        />
        <Button
          variant="secondary"
          size="sm"
          icon={<Upload size={12} />}
          onClick={() => fileInputRef.current?.click()}
          className="w-full"
        >
          {t("add")}
        </Button>
      </div>

      <RasterImportControl />
    </FloatingPanel>
  );
}

function OverlayItem({
  overlay,
  onToggle,
  onRemove,
  onOpacityChange,
}: {
  overlay: KmlOverlay;
  onToggle: () => void;
  onRemove: () => void;
  onOpacityChange: (v: number) => void;
}) {
  const t = useTranslations("planner.overlays");
  const featureCount =
    overlay.polygons.length + overlay.paths.length + overlay.points.length;
  // The slider moves a local draft; the store (and its persisted copy) is
  // written once when the drag or key press ends.
  const [draft, setDraft] = useState<number | null>(null);
  const percent = draft ?? Math.round(overlay.opacity * 100);
  const commit = () => {
    if (draft === null) return;
    onOpacityChange(draft / 100);
    setDraft(null);
  };

  return (
    <div className="px-3 py-2 border-b border-border-default last:border-b-0">
      <div className="flex items-center gap-2">
        {/* Color swatch */}
        <div
          className="w-3 h-3 rounded-sm shrink-0"
          style={{ backgroundColor: overlay.style.lineColor }}
        />

        {/* Name */}
        <span className="text-[11px] text-text-primary truncate flex-1">
          {overlay.name}
        </span>

        {/* Toggle visibility */}
        <button
          onClick={onToggle}
          className="text-text-tertiary hover:text-text-primary transition-colors cursor-pointer"
          aria-label={overlay.visible ? t("hide") : t("show")}
        >
          {overlay.visible ? <Eye size={12} /> : <EyeOff size={12} />}
        </button>

        {/* Remove */}
        <button
          onClick={onRemove}
          className="text-text-tertiary hover:text-status-error transition-colors cursor-pointer"
          aria-label={t("remove")}
        >
          <Trash2 size={12} />
        </button>
      </div>

      {/* Feature count + opacity slider */}
      <div className="flex items-center gap-2 mt-1">
        <span className="text-[11px] text-text-tertiary font-mono shrink-0">
          {t("features", { count: featureCount })}
        </span>
        <input
          type="range"
          min={0}
          max={100}
          value={percent}
          aria-label={t("opacity")}
          onChange={(e) => setDraft(Number(e.target.value))}
          onPointerUp={commit}
          onKeyUp={commit}
          onBlur={commit}
          className="flex-1 h-1 accent-accent-primary"
        />
        <span className="text-[11px] text-text-tertiary font-mono w-8 text-right">
          {percent}%
        </span>
      </div>
    </div>
  );
}
