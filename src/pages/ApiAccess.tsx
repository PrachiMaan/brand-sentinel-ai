import { AppShell } from "@/components/AppShell";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import type { Id } from "@/convex/_generated/dataModel";
import { cn } from "@/lib/utils";
import { useAction, useMutation, useQuery } from "convex/react";
import { Copy, KeyRound, Loader2, Play, Plus, Power, Trash2, Webhook } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

const SITE_URL =
  (import.meta.env.VITE_CONVEX_SITE_URL as string | undefined) ??
  "https://<deployment>.convex.site";

export default function ApiAccess() {
  const me = useQuery(api.session.me);
  const keys = useQuery(api.apiAdmin.keys);
  const endpoints = useQuery(api.apiAdmin.endpoints);
  const deliveries = useQuery(api.webhookInternal.deliveries);
  const createKey = useAction(api.apiAdminActions.createKey);
  const revokeKey = useMutation(api.apiAdmin.revokeKey);
  const createEndpoint = useAction(api.apiAdminActions.createEndpoint);
  const toggleEndpoint = useMutation(api.apiAdmin.setEndpointActive);
  const sendTest = useAction(api.webhookInternal.sendTest);
  const replay = useMutation(api.webhookInternal.replay);

  const [keyName, setKeyName] = useState("Docs sidebar");
  const [scope, setScope] = useState<"creator" | "reviewer" | "approver">("reviewer");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [endpointDesc, setEndpointDesc] = useState("Local receiver");
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const isAdmin = me?.role === "admin";

  if (!isAdmin) {
    return (
      <AppShell>
        <section className="border border-border bg-card p-6">
          <p className="label-caps">Admin only</p>
          <h2 className="mt-2 font-serif text-[24px]">API keys and webhooks</h2>
          <p className="mt-2 max-w-[62ch] text-[12px] leading-5 text-muted-foreground">
            Creating keys and endpoints is limited to the Admin seat. Switch role in the
            header to Ravi Shah to manage integrations.
          </p>
        </section>
      </AppShell>
    );
  }

  const copy = async (value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      toast("Copied");
    } catch {
      toast.error("Copy failed. Select the value and copy it manually.");
    }
  };

  return (
    <AppShell>
      <div className="space-y-6">
        <section className="border border-border bg-card">
          <div className="flex flex-wrap items-end justify-between gap-3 border-b border-border/80 px-5 py-4">
            <div>
              <p className="label-caps">Review API · v1</p>
              <h2 className="mt-1.5 font-serif text-[26px] leading-none">
                Submit and approve without opening the app
              </h2>
              <p className="mt-2 max-w-[80ch] text-[11px] leading-5 text-muted-foreground">
                Keys are scoped. A creator key can submit, a reviewer key can decide
                findings, an approver key can approve. Every call goes through the same
                state machine and the same audit chain as the web UI.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                className="rounded-none text-[11px]"
                onClick={() => copy(`${SITE_URL}/api/v1/openapi.json`)}
              >
                <Copy className="mr-1.5 size-3.5" /> OpenAPI URL
              </Button>
              <Button
                variant="outline"
                size="sm"
                className="rounded-none text-[11px]"
                onClick={() => window.open("/docs/API.md", "_blank")}
              >
                API docs
              </Button>
            </div>
          </div>

          <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1.1fr_0.9fr]">
            <div>
              <p className="label-caps">Create a key</p>
              <div className="mt-2 flex flex-wrap gap-2">
                <Input
                  value={keyName}
                  onChange={(event) => setKeyName(event.target.value)}
                  className="h-8 w-[190px] rounded-none text-[12px]"
                  placeholder="Key name"
                />
                <Select value={scope} onValueChange={(value) => setScope(value as typeof scope)}>
                  <SelectTrigger className="h-8 w-[130px] rounded-none text-[12px]">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="creator">Creator</SelectItem>
                    <SelectItem value="reviewer">Reviewer</SelectItem>
                    <SelectItem value="approver">Approver</SelectItem>
                  </SelectContent>
                </Select>
                <Button
                  size="sm"
                  className="h-8 rounded-none text-[11px]"
                  disabled={busy === "key"}
                  onClick={async () => {
                    setBusy("key");
                    try {
                      const result = await createKey({ name: keyName, scope });
                      setNewKey(result.key);
                      toast("Key created", {
                        description: "Copy it now. Only the hash is stored.",
                      });
                    } catch (error) {
                      toast.error(error instanceof Error ? error.message : "Could not create key.");
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "key" ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <KeyRound className="mr-1.5 size-3.5" />
                  )}
                  Create
                </Button>
              </div>

              {newKey && (
                <div className="mt-3 border border-[#6F7D66]/50 bg-[#6F7D66]/10 px-3 py-2">
                  <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#4F5C47]">
                    Shown once
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[10.5px]">{newKey}</code>
                    <button onClick={() => copy(newKey)} className="text-[#4F5C47] hover:text-foreground">
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 overflow-x-auto border border-border/70">
                <table className="w-full min-w-[460px] border-collapse text-left">
                  <thead>
                    <tr className="border-b border-border/70 bg-background/60">
                      {["Name", "Prefix", "Scope", "Last used", ""].map((label) => (
                        <th
                          key={label}
                          className="px-3 py-2 font-mono text-[8px] font-normal uppercase tracking-[0.1em] text-muted-foreground"
                        >
                          {label}
                        </th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {(keys ?? []).map((key) => (
                      <tr key={key.id} className="border-b border-border/60">
                        <td className="px-3 py-2 text-[11px]">{key.name}</td>
                        <td className="px-3 py-2 font-mono text-[10px] text-muted-foreground">
                          {key.prefix}…
                        </td>
                        <td className="px-3 py-2 font-mono text-[10px] capitalize">{key.scope}</td>
                        <td className="px-3 py-2 font-mono text-[9px] text-muted-foreground">
                          {key.lastUsedAt ? new Date(key.lastUsedAt).toISOString().slice(0, 16).replace("T", " ") : "never"}
                        </td>
                        <td className="px-3 py-2 text-right">
                          {key.revoked ? (
                            <span className="font-mono text-[9px] text-[#8F2F24]">revoked</span>
                          ) : (
                            <button
                              onClick={() => revokeKey({ keyId: key.id as Id<"apiKeys"> })}
                              className="text-muted-foreground hover:text-[#8F2F24]"
                              aria-label={`Revoke ${key.name}`}
                            >
                              <Trash2 className="size-3.5" />
                            </button>
                          )}
                        </td>
                      </tr>
                    ))}
                    {(keys ?? []).length === 0 && (
                      <tr>
                        <td colSpan={5} className="px-3 py-4 text-[11px] text-muted-foreground">
                          No keys yet.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            </div>

            <div className="border border-border/70 bg-background px-4 py-4">
              <p className="label-caps">Example</p>
              <pre className="mt-2 overflow-x-auto font-mono text-[10px] leading-5 text-muted-foreground">
{`curl -X POST ${SITE_URL}/api/v1/submissions \\
  -H "Authorization: Bearer $BRANDSENTINEL_KEY" \\
  -H "Idempotency-Key: $(uuidgen)" \\
  -H "content-type: application/json" \\
  -d '{"text":"Glow Serum is a miracle.",
       "channel":"instagram","team":"Social"}'

curl ${SITE_URL}/api/v1/submissions/<id>/findings \\
  -H "Authorization: Bearer $BRANDSENTINEL_KEY"`}
              </pre>
              <p className="mt-3 border-t border-border/70 pt-2 text-[10px] leading-4 text-muted-foreground">
                Base URL is the Convex site URL for this deployment, not the app URL.
                Set <code className="font-mono">VITE_CONVEX_SITE_URL</code> in the
                environment to show the exact host here.
              </p>
            </div>
          </div>
        </section>

        <section className="border border-border bg-card">
          <div className="border-b border-border/80 px-5 py-4">
            <p className="label-caps">Signed webhooks</p>
            <h2 className="mt-1.5 font-serif text-[24px] leading-none">
              findings_ready and approved, with retries
            </h2>
            <p className="mt-2 max-w-[80ch] text-[11px] leading-5 text-muted-foreground">
              HMAC-SHA256 over <code className="font-mono">timestamp.body</code>, sent as{" "}
              <code className="font-mono">X-BrandSentinel-Signature: t=…,v1=…</code>. Retries
              use 1m, 5m, 30m, 2h and 6h backoff, then the delivery is marked dead. Every
              attempt is written to the audit chain.
            </p>
          </div>

          <div className="grid gap-6 px-5 py-5 lg:grid-cols-[1fr_1fr]">
            <div>
              <div className="flex flex-wrap gap-2">
                <Input
                  value={endpointUrl}
                  onChange={(event) => setEndpointUrl(event.target.value)}
                  className="h-8 min-w-[220px] flex-1 rounded-none font-mono text-[11px]"
                  placeholder="https://example.com/hooks/brandsentinel"
                />
                <Input
                  value={endpointDesc}
                  onChange={(event) => setEndpointDesc(event.target.value)}
                  className="h-8 w-[150px] rounded-none text-[11px]"
                  placeholder="Label"
                />
                <Button
                  size="sm"
                  className="h-8 rounded-none text-[11px]"
                  disabled={busy === "endpoint"}
                  onClick={async () => {
                    setBusy("endpoint");
                    try {
                      const result = await createEndpoint({
                        url: endpointUrl,
                        description: endpointDesc,
                        events: ["findings_ready", "approved"],
                      });
                      setNewSecret(result.secret);
                      setEndpointUrl("");
                      toast("Endpoint created", {
                        description: "Copy the signing secret now.",
                      });
                    } catch (error) {
                      toast.error(
                        error instanceof Error ? error.message : "Could not save endpoint.",
                      );
                    } finally {
                      setBusy(null);
                    }
                  }}
                >
                  {busy === "endpoint" ? (
                    <Loader2 className="mr-1.5 size-3.5 animate-spin" />
                  ) : (
                    <Plus className="mr-1.5 size-3.5" />
                  )}
                  Add
                </Button>
              </div>

              {newSecret && (
                <div className="mt-3 border border-[#6F7D66]/50 bg-[#6F7D66]/10 px-3 py-2">
                  <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-[#4F5C47]">
                    Signing secret · shown once
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <code className="min-w-0 flex-1 truncate font-mono text-[10.5px]">
                      {newSecret}
                    </code>
                    <button onClick={() => copy(newSecret)} className="text-[#4F5C47] hover:text-foreground">
                      <Copy className="size-3.5" />
                    </button>
                  </div>
                </div>
              )}

              <div className="mt-4 space-y-2">
                {(endpoints ?? []).map((endpoint) => (
                  <div
                    key={endpoint.id}
                    className="flex flex-wrap items-center gap-2 border border-border/70 px-3 py-2"
                  >
                    <Webhook className="size-3.5 text-muted-foreground" />
                    <span className="min-w-0 flex-1 truncate font-mono text-[10px]">
                      {endpoint.url}
                    </span>
                    <span className="font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground">
                      {endpoint.events.join(" · ")}
                    </span>
                    <span
                      className={cn(
                        "font-mono text-[8.5px] uppercase tracking-[0.1em]",
                        endpoint.active ? "text-[#4F5C47]" : "text-[#8F2F24]",
                      )}
                    >
                      {endpoint.active ? "active" : "paused"}
                    </span>
                    <button
                      onClick={() =>
                        toggleEndpoint({
                          endpointId: endpoint.id as Id<"webhookEndpoints">,
                          active: !endpoint.active,
                        })
                      }
                      className="text-muted-foreground hover:text-foreground"
                      aria-label={endpoint.active ? "Pause endpoint" : "Enable endpoint"}
                    >
                      <Power className="size-3.5" />
                    </button>
                    <button
                      onClick={async () => {
                        try {
                          await sendTest({ endpointId: endpoint.id as Id<"webhookEndpoints"> });
                          toast("Test event sent");
                        } catch (error) {
                          toast.error(
                            error instanceof Error ? error.message : "Test failed.",
                          );
                        }
                      }}
                      className="text-muted-foreground hover:text-foreground"
                      aria-label="Send test event"
                    >
                      <Play className="size-3.5" />
                    </button>
                  </div>
                ))}
                {(endpoints ?? []).length === 0 && (
                  <p className="text-[11px] text-muted-foreground">
                    No endpoints. Add one to receive findings_ready and approved events.
                  </p>
                )}
              </div>
            </div>

            <div className="border border-border/70">
              <div className="border-b border-border/70 bg-background/60 px-3 py-2">
                <p className="font-mono text-[8.5px] uppercase tracking-[0.12em] text-muted-foreground">
                  Delivery log
                </p>
              </div>
              <div className="max-h-[320px] overflow-y-auto">
                {(deliveries ?? []).map((delivery) => (
                  <div
                    key={delivery.id}
                    className="flex flex-wrap items-center gap-2 border-b border-border/60 px-3 py-2 last:border-b-0"
                  >
                    <span className="font-mono text-[9px]">{delivery.eventType}</span>
                    <span
                      className={cn(
                        "font-mono text-[8.5px] uppercase tracking-[0.1em]",
                        delivery.status === "delivered"
                          ? "text-[#4F5C47]"
                          : delivery.status === "dead"
                            ? "text-[#8F2F24]"
                            : "text-[#7A6334]",
                      )}
                    >
                      {delivery.status}
                    </span>
                    <span className="font-mono text-[8.5px] text-muted-foreground">
                      attempt {delivery.attempt}
                      {delivery.responseCode ? ` · ${delivery.responseCode}` : ""}
                    </span>
                    {delivery.error && (
                      <span
                        title={delivery.error}
                        className="min-w-0 flex-1 truncate font-mono text-[8.5px] text-[#8F2F24]"
                      >
                        {delivery.error}
                      </span>
                    )}
                    <button
                      onClick={() => replay({ deliveryId: delivery.id as Id<"webhookDeliveries"> })}
                      className="ml-auto font-mono text-[8.5px] uppercase tracking-[0.1em] text-muted-foreground hover:text-foreground"
                    >
                      replay
                    </button>
                  </div>
                ))}
                {(deliveries ?? []).length === 0 && (
                  <p className="px-3 py-4 text-[11px] text-muted-foreground">
                    No deliveries yet.
                  </p>
                )}
              </div>
            </div>
          </div>
        </section>

        <section className="border border-border bg-card/60 px-5 py-4">
          <p className="label-caps">Google Docs sidebar</p>
          <p className="mt-2 max-w-[84ch] text-[11px] leading-5 text-muted-foreground">
            The Apps Script project in <code className="font-mono">integrations/google-docs/</code>{" "}
            reads the document body, submits it to this API, shows findings in the sidebar
            and highlights spans in the Doc. It stores the API key in user properties, never
            in the document. Install steps are in{" "}
            <code className="font-mono">integrations/google-docs/INSTALL.md</code>.
          </p>
        </section>
      </div>
    </AppShell>
  );
}
