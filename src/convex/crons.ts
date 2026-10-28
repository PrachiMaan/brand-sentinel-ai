import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Rule Health aggregates are refreshed daily so the dashboard is never a
// hand-maintained snapshot. The admin can also recompute on demand.
crons.daily(
  "recompute rule health",
  { hourUTC: 2, minuteUTC: 30 },
  internal.analytics.recomputeRecent,
  {},
);

export default crons;
