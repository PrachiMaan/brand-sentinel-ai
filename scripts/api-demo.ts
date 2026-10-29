/**
 * End-to-end Review API demo and proof.
 *
 *   BASE_URL=https://<deployment>.convex.site/api/v1 \
 *   BRANDSENTINEL_KEY=bss_live_…            # approver scope
 *   BRANDSENTINEL_CREATOR_KEY=bss_live_…    # creator scope
 *   bun run scripts/api-demo.ts
 *
 * What it proves, in order:
 *   1. OpenAPI is served.
 *   2. Submit with an Idempotency-Key returns a submission id.
 *   3. Replaying the same key and body returns the same submission.
 *   4. The same key with a different body returns 409.
 *   5. A creator key cannot approve (403).
 *   6. The submission reaches findings_ready and returns verified findings.
 *   7. Accepting every pending finding clears the approval gate.
 *   8. The approver key approves, and the status endpoint confirms it.
 *   9. The receipt manifest (version, decisions, counts) is complete.
 *  10. The 61st request in a minute with one key returns 429.
 *
 * The Review Receipt PDF itself is generated in the web app; the API has no
 * receipt endpoint. Step 9 confirms the data the receipt is built from.
 */

const BASE = (process.env.BASE_URL ?? "https://tremendous-rabbit-679.convex.site/api/v1").replace(
  /\/+$/,
  "",
);
const APPROVER = process.env.BRANDSENTINEL_KEY ?? "";
const CREATOR = process.env.BRANDSENTINEL_CREATOR_KEY ?? "";

if (!APPROVER || !CREATOR) {
  console.error("Set BRANDSENTINEL_KEY (approver) and BRANDSENTINEL_CREATOR_KEY (creator).");
  process.exit(2);
}

type ApiError = { error?: { code?: string; message?: string } };
type SubmitBody = ApiError & { id?: string };
type StatusBody = ApiError & {
  status?: string;
  version?: number;
  degraded?: boolean;
  degradedCause?: string | null;
  counts?: Record<string, number>;
  source?: string | null;
};
type Finding = {
  id: string;
  severity: string;
  ruleId: string;
  spanText: string;
  status: string;
};
type FindingsBody = ApiError & { findings?: Finding[] };
type Reply<T> = { status: number; body: T | null; headers: Headers };

const checks: { name: string; ok: boolean; detail: string }[] = [];
function check(name: string, ok: boolean, detail: string) {
  checks.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

async function call<T>(
  method: "GET" | "POST",
  path: string,
  opts: { key?: string; body?: unknown; idempotency?: string } = {},
): Promise<Reply<T>> {
  const headers: Record<string, string> = { authorization: `Bearer ${opts.key ?? APPROVER}` };
  if (opts.body !== undefined) headers["content-type"] = "application/json";
  if (opts.idempotency) headers["idempotency-key"] = opts.idempotency;
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers,
    body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  });
  let body: T | null = null;
  const text = await response.text();
  try {
    body = text ? (JSON.parse(text) as T) : null;
  } catch {
    body = null;
  }
  return { status: response.status, body, headers: response.headers };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const suffix = `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

async function main() {
  console.log(`Base: ${BASE}`);
  console.log(`Run:  ${suffix}\n`);

  const openapi = await call<{ paths?: Record<string, unknown> }>("GET", "/openapi.json", {
    key: "",
  });
  check(
    "OpenAPI served",
    openapi.status === 200 && Boolean(openapi.body?.paths?.["/submissions"]),
    `HTTP ${openapi.status}, ${Object.keys(openapi.body?.paths ?? {}).length} paths`,
  );

  const copy = {
    title: `API proof ${suffix}`,
    text:
      "Glow Serum is here and it is a MIRACLE for tired skin! Clinically proven to remove wrinkles in 7 days. Get yours before it sells out!!",
    channel: "instagram",
    audience: "Skincare-curious adults, 25-44",
    team: "Social",
    externalRef: `proof-${suffix}`,
  };
  const idempotency = `proof-${suffix}`;

  const created = await call<SubmitBody>("POST", "/submissions", { body: copy, idempotency });
  const submissionId = created.body?.id;
  check(
    "Submit",
    created.status === 202 && Boolean(submissionId),
    `HTTP ${created.status}, id ${submissionId ?? "missing"}`,
  );
  if (!submissionId) return finish();

  const replay = await call<SubmitBody>("POST", "/submissions", { body: copy, idempotency });
  check(
    "Same-key replay returns the same submission",
    replay.status === 202 && replay.body?.id === submissionId,
    `HTTP ${replay.status}, id ${replay.body?.id ?? "missing"}`,
  );

  const conflict = await call<ApiError>("POST", "/submissions", {
    body: { ...copy, text: "Different copy with the same idempotency key." },
    idempotency,
  });
  check(
    "Conflicting body gives 409",
    conflict.status === 409 && conflict.body?.error?.code === "conflict",
    `HTTP ${conflict.status}, code ${conflict.body?.error?.code ?? "none"}`,
  );

  const creatorApprove = await call<ApiError>("POST", `/submissions/${submissionId}/decision`, {
    key: CREATOR,
    body: { decision: "approve" },
  });
  check(
    "Creator-scope key cannot approve",
    creatorApprove.status === 403 && creatorApprove.body?.error?.code === "forbidden",
    `HTTP ${creatorApprove.status}, code ${creatorApprove.body?.error?.code ?? "none"}`,
  );

  let status = "draft";
  let snapshot: StatusBody | null = null;
  const deadline = Date.now() + 120_000;
  while (Date.now() < deadline) {
    const reply = await call<StatusBody>("GET", `/submissions/${submissionId}`);
    snapshot = reply.body;
    status = reply.body?.status ?? "unknown";
    if (status === "findings_ready" || status === "human_review") break;
    if (reply.status !== 200) break;
    await sleep(2_000);
  }
  check(
    "Review completes",
    status === "findings_ready" || status === "human_review",
    `status ${status}${snapshot?.degraded ? `, degraded: ${snapshot.degradedCause ?? "unknown"}` : ""}`,
  );

  const findingsReply = await call<FindingsBody>(
    "GET",
    `/submissions/${submissionId}/findings`,
  );
  const findings = findingsReply.body?.findings ?? [];
  check(
    "Findings returned",
    findingsReply.status === 200 && findings.length > 0,
    `${findings.length} findings, ${findings.filter((f) => f.status === "pending").length} pending`,
  );
  if (findings.length) {
    const first = findings[0];
    console.log(
      `      first: ${first.severity} ${first.ruleId} "${String(first.spanText).slice(0, 60)}"`,
    );
  }

  let decided = 0;
  for (const finding of findings.filter((row) => row.status === "pending")) {
    const decision =
      finding.severity === "low"
        ? { decision: "reject", reason: "Minor wording; accepted for this test run." }
        : { decision: "accept" };
    const reply = await call<ApiError>("POST", `/submissions/${submissionId}/decision`, {
      body: { findingId: finding.id, ...decision },
    });
    if (reply.status === 200) decided += 1;
    else
      check(
        `Decide ${finding.id}`,
        false,
        `HTTP ${reply.status}, ${reply.body?.error?.message ?? "no message"}`,
      );
  }
  check("Pending findings decided", decided > 0, `${decided} decisions recorded`);

  const approved = await call<StatusBody>("POST", `/submissions/${submissionId}/decision`, {
    body: { decision: "approve" },
  });
  check(
    "Approver key approves",
    approved.status === 200 && approved.body?.status === "approved",
    `HTTP ${approved.status}, status ${approved.body?.status ?? approved.body?.error?.code ?? "none"}`,
  );

  const finalStatus = await call<StatusBody>("GET", `/submissions/${submissionId}`);
  check(
    "Status endpoint confirms approval",
    finalStatus.body?.status === "approved",
    `status ${finalStatus.body?.status ?? "unknown"}, version ${finalStatus.body?.version ?? "?"}`,
  );

  const finalFindings = await call<FindingsBody>(
    "GET",
    `/submissions/${submissionId}/findings`,
  );
  const rows = finalFindings.body?.findings ?? [];
  const pending = rows.filter((row) => row.status === "pending").length;
  const manifest = {
    submissionId,
    version: finalStatus.body?.version ?? null,
    status: finalStatus.body?.status ?? null,
    findings: rows.length,
    decisions: rows.length - pending,
    pending,
    counts: finalStatus.body?.counts ?? {},
    source: finalStatus.body?.source ?? null,
    degraded: finalStatus.body?.degraded ?? false,
  };
  check(
    "Receipt manifest complete",
    manifest.status === "approved" && manifest.pending === 0 && manifest.version !== null,
    `${manifest.decisions}/${manifest.findings} decisions, version ${manifest.version}, source ${manifest.source}`,
  );

  // Rate limit is 60 requests per minute per key. Use the creator key, whose
  // only prior call was the 403 probe, and read a resource rather than write.
  let last: Reply<ApiError> | null = null;
  let hits = 0;
  for (let i = 0; i < 65; i++) {
    last = await call<ApiError>("GET", `/submissions/${submissionId}`, { key: CREATOR });
    if (last.status === 429) break;
    hits += 1;
  }
  check(
    "Rate limit returns 429",
    last?.status === 429 && last?.body?.error?.code === "rate_limited",
    `HTTP ${last?.status} after ${hits} requests, retry-after ${last?.headers.get("retry-after") ?? "none"}s`,
  );

  console.log("\nReceipt manifest");
  console.log(JSON.stringify(manifest, null, 2));
  return finish();
}

async function finish() {
  const failed = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - failed.length}/${checks.length} checks passed`);
  if (failed.length) {
    for (const f of failed) console.log(`  FAIL ${f.name}: ${f.detail}`);
    process.exit(1);
  }
  console.log("API demo complete.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
