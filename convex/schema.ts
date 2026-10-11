import { defineSchema } from "convex/server";
import { sharedTables } from "./schemaTables";

export default defineSchema(sharedTables());
