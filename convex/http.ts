import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { registerSharedRoutes } from "./httpShared";

const http = httpRouter();
auth.addHttpRoutes(http);
registerSharedRoutes(http);

export default http;
