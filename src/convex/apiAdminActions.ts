"use node";

import { v } from "convex/values";
import { action } from "./_generated/server";
import { internal } from "./_generated/api";
import type { Id } from "./_generated/dataModel";
import { randomBytes } from "node:crypto";
import { sha256Hex } from "./lib/sha256";
import { checkEndpointUrl } from "./lib/webhooks";

/**
 * Secrets are generated here (Node runtime) and stored hashed. The plain key or
 * signing secret is returned exactly once, to the admin who created it.
 */

export const createKey = action({
  args: {
    name: v.string(),
    scope: v.union(v.literal("creator"), v.literal("reviewer"), v.literal("approver")),
  },
  handler: async (ctx, args): Promise<{ key: string; prefix: string; id: string }> => {
    const session: { workspaceId: Id<"workspaces">; displayName: string } = await ctx.runQuery(
      internal.apiAdmin.access,
      {},
    );
    const name = args.name.trim().slice(0, 80) || "Untitled key";
    const secret = `bss_live_${randomBytes(24).toString("hex")}`;
    const prefix = secret.slice(0, 17);
    const id: Id<"apiKeys"> = await ctx.runMutation(internal.apiAdmin.storeKey, {
      workspaceId: session.workspaceId,
      name,
      prefix,
      keyHash: sha256Hex(secret),
      scope: args.scope,
      createdBy: session.displayName,
    });
    return { key: secret, prefix, id };
  },
});

export const createEndpoint = action({
  args: {
    url: v.string(),
    description: v.string(),
    events: v.array(v.string()),
  },
  handler: async (ctx, args): Promise<{ id: string; secret: string }> => {
    const check = checkEndpointUrl(args.url);
    if (!check.ok) throw new Error(check.reason);
    const events = args.events.filter((event) =>
      ["findings_ready", "approved"].includes(event),
    );
    if (!events.length) throw new Error("Choose at least one event.");
    const secret = `whsec_${randomBytes(24).toString("hex")}`;
    const id: Id<"webhookEndpoints"> = await ctx.runMutation(
      internal.apiAdmin.storeEndpoint,
      {
        url: check.url,
        description: args.description,
        events,
        secret,
      },
    );
    return { id, secret };
  },
});
