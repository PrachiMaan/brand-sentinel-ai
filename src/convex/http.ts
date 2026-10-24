import { httpRouter } from "convex/server";
import { httpAction } from "./_generated/server";
import { internal } from "./_generated/api";
import { auth } from "./auth";

const http = httpRouter();

auth.addHttpRoutes(http);

/**
 * Evaluation harness endpoint. The script posts a small batch of red-team items
 * and receives the raw pipeline output. It is protected by EVAL_KEY when that
 * variable is set on the deployment.
 */
http.route({
  path: "/eval/run",
  method: "POST",
  handler: httpAction(async (ctx, request) => {
    try {
      const body = await request.text();
      const token = request.headers.get("x-eval-key") ?? undefined;
      const result = await ctx.runAction(internal.evalActions.runBatch, {
        itemsJson: body,
        token,
      });
      return new Response(JSON.stringify(result), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    } catch (error) {
      return new Response(
        JSON.stringify({
          error: error instanceof Error ? error.message : "Eval batch failed.",
        }),
        {
          status: 400,
          headers: { "content-type": "application/json" },
        },
      );
    }
  }),
});

export default http;
