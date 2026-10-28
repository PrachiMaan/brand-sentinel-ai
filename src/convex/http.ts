import { httpRouter } from "convex/server";
import { auth } from "./auth";
import { api } from "./httpApi";

const http = httpRouter();

auth.addHttpRoutes(http);

// Versioned review API. One handler owns the routing so the OpenAPI document
// and the real behaviour stay in the same file.
http.route({ pathPrefix: "/api/v1/", method: "GET", handler: api });
http.route({ pathPrefix: "/api/v1/", method: "POST", handler: api });
http.route({ pathPrefix: "/api/v1/", method: "OPTIONS", handler: api });

export default http;
