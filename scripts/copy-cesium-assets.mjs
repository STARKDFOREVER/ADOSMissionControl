#!/usr/bin/env node
import { cpSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";

const source = join(process.cwd(), "node_modules", "cesium", "Build", "Cesium");
const destination = join(process.cwd(), "public", "cesium");

if (!existsSync(source)) {
  throw new Error(`Cesium build assets not found at ${source}; run npm install`);
}

rmSync(destination, { recursive: true, force: true });
cpSync(source, destination, { recursive: true });
console.log("[cesium] copied build assets to public/cesium");
