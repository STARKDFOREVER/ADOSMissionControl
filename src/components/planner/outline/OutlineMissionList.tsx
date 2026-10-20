"use client";

/**
 * @module outline/OutlineMissionList
 * @description The waypoint rows of the plan outline: click to select
 * (Ctrl/Cmd adds, Shift selects a range), drag to reorder, a hover `+`
 * between rows to insert, a hover delete, and a right-click menu that resumes
 * the plan from a row. The selected row scrolls into view when the selection
 * changes elsewhere (map, keyboard).
 * @license GPL-3.0-only
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus } from "lucide-react";
import type { Waypoint } from "@/lib/types/mission";
import { usePlannerStore } from "@/stores/planner-store";
import { useMissionStore } from "@/stores/mission-store";
import { useDroneManager, selectSelectedProtocol } from "@/stores/drone-manager";
import { OutlineWaypointRow } from "./OutlineWaypointRow";
import { OutlineEmpty } from "./OutlineItemRow";
import { OutlineRowMenu } from "./OutlineRowMenu";

interface OutlineMissionListProps {
  waypoints: Waypoint[];
  selectedId: string | null;
  onClick: (id: string, additive?: boolean, range?: boolean) => void;
  onRemove: (id: string) => void;
  onReorder: (fromIndex: number, toIndex: number) => void;
  onInsertAt: (index: number) => void;
}

export function OutlineMissionList({
  waypoints, selectedId, onClick, onRemove, onReorder, onInsertAt,
}: OutlineMissionListProps) {
  const t = useTranslations("planner");
  const selectedIds = usePlannerStore((s) => s.selectedWaypointIds);
  const defaultFrame = usePlannerStore((s) => s.defaultFrame);
  // The same home datum the flight plan and the validator use: the planned
  // home's ground, else the launch waypoint's sample.
  const homeGroundElevation = useMissionStore(
    (s) => s.plannedHome?.groundAmsl ?? s.waypoints[0]?.groundElevation,
  );
  const protocol = useDroneManager(selectSelectedProtocol);
  const isInav = protocol?.getVehicleInfo()?.firmwareType === "inav";

  const [dragOverIndex, setDragOverIndex] = useState<number | null>(null);
  const [rowMenu, setRowMenu] = useState<{ index: number; x: number; y: number } | null>(null);
  const closeRowMenu = useCallback(() => setRowMenu(null), []);
  const handleContextMenu = useCallback((index: number, e: React.MouseEvent) => {
    e.preventDefault();
    setRowMenu({ index, x: e.clientX, y: e.clientY });
  }, []);
  const dragIndexRef = useRef<number | null>(null);
  const rowRefs = useRef(new Map<string, HTMLElement>());

  // Row handlers stay identity-stable so a memoised row re-renders only when
  // its own waypoint or flags change; they read the latest props via a ref.
  const latest = useRef({ onClick, onRemove, onReorder });
  useLayoutEffect(() => {
    latest.current = { onClick, onRemove, onReorder };
  });

  const handleClick = useCallback((id: string, e: React.MouseEvent) => {
    latest.current.onClick(id, e.ctrlKey || e.metaKey, e.shiftKey);
  }, []);
  const handleRemove = useCallback((id: string) => latest.current.onRemove(id), []);

  const handleDragStart = useCallback((index: number, e: React.DragEvent) => {
    dragIndexRef.current = index;
    e.dataTransfer.effectAllowed = "move";
  }, []);
  const handleDragOver = useCallback((index: number, e: React.DragEvent) => {
    if (dragIndexRef.current === null) return;
    e.preventDefault();
    e.dataTransfer.dropEffect = "move";
    // Over its own row the drag has no drop target to mark.
    setDragOverIndex(index === dragIndexRef.current ? null : index);
  }, []);
  const handleDrop = useCallback((toIndex: number, e: React.DragEvent) => {
    const from = dragIndexRef.current;
    if (from === null) return;
    e.preventDefault();
    if (from !== toIndex) latest.current.onReorder(from, toIndex);
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);
  const handleDragEnd = useCallback(() => {
    dragIndexRef.current = null;
    setDragOverIndex(null);
  }, []);

  const registerRow = useCallback((id: string, el: HTMLElement | null) => {
    if (el) rowRefs.current.set(id, el);
    else rowRefs.current.delete(id);
  }, []);

  // Reveal the row the inspector is editing, wherever it was selected from.
  useEffect(() => {
    if (!selectedId) return;
    const store = usePlannerStore.getState();
    if (store.sectionOpen?.["outline.mission"] === false) {
      // The row stays hidden until the group re-renders open.
      store.setSectionOpen("outline.mission", true);
      const raf = requestAnimationFrame(() => {
        rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
      });
      return () => cancelAnimationFrame(raf);
    }
    rowRefs.current.get(selectedId)?.scrollIntoView?.({ block: "nearest" });
  }, [selectedId]);

  if (waypoints.length === 0) {
    return <OutlineEmpty>{t("addWaypointHint")}</OutlineEmpty>;
  }

  return (
    <div className="flex flex-col">
      {waypoints.map((wp, i) => (
        // Off-screen rows skip layout and paint, so a long survey list stays cheap.
        <div key={wp.id} className="group/gap relative [content-visibility:auto] [contain-intrinsic-size:auto_28px]">
          {i > 0 && (
            // The handle sits in the grip gutter at the top edge of the row
            // (inside it: content-visibility clips overflow), so it never covers
            // a row's click target; the guide line is decoration only.
            <button
              type="button"
              onClick={() => onInsertAt(i)}
              aria-label={t("outline.insertAt", { n: i + 1 })}
              title={t("insertWaypointHere")}
              className="peer absolute left-0.5 top-0 z-10 flex h-3 w-3 items-center justify-center rounded-full bg-text-secondary text-bg-primary opacity-0 transition-opacity group-hover/gap:opacity-60 hover:opacity-100 focus-visible:opacity-100 cursor-pointer focus-ring"
            >
              <Plus size={9} aria-hidden />
            </button>
          )}
          {i > 0 && (
            <span
              aria-hidden
              className="pointer-events-none absolute left-4 right-2 top-0 z-10 h-px bg-text-secondary opacity-0 transition-opacity peer-hover:opacity-100 peer-focus-visible:opacity-100"
            />
          )}
          <OutlineWaypointRow
            waypoint={wp}
            index={i}
            selected={selectedId === wp.id}
            multiSelected={selectedIds.includes(wp.id)}
            isInav={isInav}
            defaultFrame={defaultFrame}
            homeGroundElevation={homeGroundElevation}
            onClick={handleClick}
            onRemove={handleRemove}
            onDragStart={handleDragStart}
            onDragOver={handleDragOver}
            onDragEnd={handleDragEnd}
            onDrop={handleDrop}
            dragOver={dragOverIndex === i}
            registerRow={registerRow}
            onContextMenu={isInav ? undefined : handleContextMenu}
          />
        </div>
      ))}
      {rowMenu && (
        <OutlineRowMenu
          index={rowMenu.index}
          count={waypoints.length}
          x={rowMenu.x}
          y={rowMenu.y}
          onClose={closeRowMenu}
        />
      )}
    </div>
  );
}
