/**
 * @module community-html
 * @description Client-side sanitizer for changelog bodies, built on DOMPurify
 * (which uses the browser's own parser). Only a small set of formatting tags
 * survives; links open in a new tab with `noopener noreferrer`, and only
 * syntax-highlight `language-*` classes on `pre`/`code` are kept.
 * @license GPL-3.0-only
 */

import { useMemo, useSyncExternalStore } from "react";
import DOMPurify, { type DOMPurify as DOMPurifyInstance } from "dompurify";

const ALLOWED_CHANGELOG_TAGS = [
  "a",
  "blockquote",
  "br",
  "code",
  "em",
  "li",
  "ol",
  "p",
  "pre",
  "strong",
  "ul",
];

const ALLOWED_ATTRS = ["href", "name", "target", "rel", "class"];
const CLASS_TAGS: Record<string, true> = { PRE: true, CODE: true };
const LANGUAGE_CLASS = /^language-[\w-]+$/;
// http, https and mailto only; anything else (javascript:, data:) is dropped.
// Relative and fragment URLs carry no scheme and pass.
const ALLOWED_URI = /^(?:(?:https?|mailto):|[^a-z]|[a-z+.-]+(?:[^a-z+.\-:]|$))/i;

let purifier: DOMPurifyInstance | null = null;

/** One dedicated instance so these hooks never leak into other DOMPurify users. */
function getPurifier(): DOMPurifyInstance | null {
  if (purifier) return purifier;
  if (typeof window === "undefined") return null;
  const p = DOMPurify(window);
  if (!p.isSupported) return null;
  p.addHook("uponSanitizeAttribute", (node, data) => {
    if (data.attrName !== "class") return;
    // Only syntax-highlight language classes survive; any other class could
    // restyle an entry into a page-covering overlay.
    const kept = CLASS_TAGS[node.nodeName]
      ? data.attrValue.split(/\s+/).filter((c) => LANGUAGE_CLASS.test(c))
      : [];
    if (kept.length === 0) data.keepAttr = false;
    else data.attrValue = kept.join(" ");
  });
  p.addHook("afterSanitizeAttributes", (node) => {
    if (node.nodeName === "A") {
      node.setAttribute("rel", "noopener noreferrer");
      node.setAttribute("target", "_blank");
    }
  });
  purifier = p;
  return p;
}

/**
 * Sanitize a changelog body. Without a DOM (server render) nothing is
 * returned: an unsanitized string must never reach `innerHTML`.
 */
export function sanitizeChangelogHtml(html: string): string {
  const p = getPurifier();
  if (!p) return "";
  return p.sanitize(html, {
    ALLOWED_TAGS: ALLOWED_CHANGELOG_TAGS,
    ALLOWED_ATTR: ALLOWED_ATTRS,
    ALLOWED_URI_REGEXP: ALLOWED_URI,
  });
}

const noopSubscribe = () => () => {};

/**
 * Sanitized changelog HTML for rendering. Empty during server render and
 * hydration (so the markup matches), then the sanitized body.
 */
export function useSanitizedChangelogHtml(html: string): string {
  const isClient = useSyncExternalStore(noopSubscribe, () => true, () => false);
  return useMemo(() => (isClient ? sanitizeChangelogHtml(html) : ""), [isClient, html]);
}
