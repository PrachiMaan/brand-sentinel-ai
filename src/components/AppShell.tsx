import { Wordmark } from "@/components/brand/chips";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { api } from "@/convex/_generated/api";
import { useAuth } from "@/hooks/use-auth";
import { cn } from "@/lib/utils";
import { useMutation, useQuery } from "convex/react";
import {
  BookOpen,
  FileCheck2,
  Gauge,
  LayoutList,
  Loader2,
  LogOut,
  PenLine,
  ScrollText,
  ShieldCheck,
} from "lucide-react";
import type { ReactNode } from "react";
import { Link, NavLink, useLocation, useNavigate } from "react-router";
import { toast } from "sonner";

const NAV = [
  { to: "/app", label: "Review queue", icon: LayoutList, end: true },
  { to: "/app/submit", label: "New submission", icon: PenLine },
  { to: "/app/rulebook", label: "Rulebook", icon: BookOpen },
  { to: "/app/rules", label: "Rule health", icon: Gauge },
  { to: "/app/audit", label: "Audit trail", icon: ScrollText },
  { to: "/app/reliability", label: "Reliability", icon: ShieldCheck },
];

const PAGE_TITLE: Record<string, { title: string; note: string }> = {
  "/app": { title: "Review queue", note: "Everything waiting on a human decision." },
  "/app/submit": { title: "New submission", note: "Fast lane runs as you type." },
  "/app/rulebook": { title: "Rulebook", note: "Published rules, claims and glossary." },
  "/app/rules": { title: "Rule health", note: "Where reviewers disagree with the machine." },
  "/app/audit": { title: "Audit trail", note: "Append-only. Every row commits to the last." },
  "/app/reliability": { title: "Reliability", note: "Model calls, verifier counts and eval results." },
};

export function AppShell({
  children,
  title,
  note,
}: {
  children: ReactNode;
  title?: string;
  note?: string;
}) {
  const me = useQuery(api.session.me);
  const { signOut } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const switchRole = useMutation(api.session.switchRole);
  const fallback = PAGE_TITLE[location.pathname] ?? {
    title: "Review",
    note: "Brand governance, with evidence.",
  };
  const heading = title ?? fallback.title;
  const subheading = note ?? fallback.note;

  const onSwitch = async (role: "creator" | "reviewer" | "approver" | "admin") => {
    try {
      const result = await switchRole({ role });
      toast(`Now acting as ${result.displayName}`, {
        description: `Role: ${role}. The switch is recorded in the audit trail.`,
      });
    } catch (error) {
      toast.error(error instanceof Error ? error.message : "Could not switch role.");
    }
  };

  const onSignOut = async () => {
    await signOut();
    navigate("/");
  };

  return (
    <div className="min-h-screen">
      <div className="mx-auto flex w-full max-w-[1440px]">
        <aside className="sticky top-0 hidden h-screen w-[248px] shrink-0 flex-col border-r border-border/80 px-5 py-6 lg:flex">
          <Link to="/" className="px-1">
            <Wordmark />
          </Link>
          <p className="mt-3 px-1 font-mono text-[10px] uppercase tracking-[0.16em] text-muted-foreground">
            Lumora Studio · demo
          </p>

          <nav className="mt-9 flex flex-col gap-[2px]">
            {NAV.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  cn(
                    "group flex items-center gap-3 border-l-2 px-3 py-[9px] text-[13px] transition-colors",
                    isActive
                      ? "border-foreground bg-foreground/[0.045] text-foreground"
                      : "border-transparent text-muted-foreground hover:bg-foreground/[0.025] hover:text-foreground",
                  )
                }
              >
                <item.icon className="size-[15px] opacity-70" strokeWidth={1.5} />
                {item.label}
              </NavLink>
            ))}
          </nav>

          <div className="mt-auto space-y-4">
            <div className="border border-border/80 p-3">
              <p className="label-caps text-[9px]">Signed in</p>
              <p className="mt-1 font-serif text-[16px] leading-tight">
                {me?.displayName ?? "Demo guest"}
              </p>
              <p className="mt-0.5 text-[11px] capitalize text-muted-foreground">
                {me?.role ?? "no role"} · Lumora Studio
              </p>
              <div className="mt-3 flex items-center justify-between border-t border-border/70 pt-2">
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-muted-foreground">
                  {me?.ruleCount ?? 0} rules · {me?.claimCount ?? 0} claims
                </span>
                <button
                  onClick={onSignOut}
                  className="text-muted-foreground transition-colors hover:text-foreground"
                  title="Sign out"
                >
                  <LogOut className="size-[14px]" strokeWidth={1.5} />
                </button>
              </div>
            </div>
            <p className="px-1 text-[10px] leading-4 text-muted-foreground/80">
              Synthetic brand and seeded data. Nothing here is a real client.
            </p>
          </div>
        </aside>

        <div className="min-w-0 flex-1">
          <header className="sticky top-0 z-20 border-b border-border/80 bg-background/95 backdrop-blur">
            <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3 sm:px-7">
              <div className="flex items-center gap-4">
                <Link to="/app" className="lg:hidden">
                  <Wordmark compact />
                </Link>
                <div className="hidden lg:block">
                  <p className="label-caps text-[9px]">Lumora Studio</p>
                  <h1 className="mt-0.5 font-serif text-[22px] leading-none">{heading}</h1>
                </div>
              </div>

              <div className="flex items-center gap-3">
                <div className="hidden items-center gap-2 sm:flex">
                  <span className="label-caps text-[9px]">Acting as</span>
                  <Select
                    value={me?.role}
                    onValueChange={(value) =>
                      onSwitch(value as "creator" | "reviewer" | "approver" | "admin")
                    }
                  >
                    <SelectTrigger className="h-8 w-[132px] rounded-none border-border bg-card text-[12px] capitalize">
                      <SelectValue placeholder="Choose role" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value="creator">Creator</SelectItem>
                      <SelectItem value="reviewer">Reviewer</SelectItem>
                      <SelectItem value="approver">Approver</SelectItem>
                      <SelectItem value="admin">Admin</SelectItem>
                    </SelectContent>
                  </Select>
                </div>
                <Button
                  asChild
                  size="sm"
                  className="h-8 rounded-none px-3 text-[12px]"
                >
                  <Link to="/app/submit">
                    <FileCheck2 className="mr-1.5 size-3.5" strokeWidth={1.6} />
                    Submit content
                  </Link>
                </Button>
              </div>
            </div>

            <div className="flex items-center justify-between gap-3 border-t border-border/60 px-4 py-2 lg:hidden">
              <div className="flex items-center gap-2">
                <span className="label-caps text-[9px]">Role</span>
                <Select
                  value={me?.role}
                  onValueChange={(value) =>
                    onSwitch(value as "creator" | "reviewer" | "approver" | "admin")
                  }
                >
                  <SelectTrigger className="h-7 w-[118px] rounded-none border-border bg-card text-[11px] capitalize">
                    <SelectValue placeholder="Choose" />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="creator">Creator</SelectItem>
                    <SelectItem value="reviewer">Reviewer</SelectItem>
                    <SelectItem value="approver">Approver</SelectItem>
                    <SelectItem value="admin">Admin</SelectItem>
                  </SelectContent>
                </Select>
              </div>
              <span className="font-mono text-[10px] text-muted-foreground">
                {me?.displayName ?? "Demo"}
              </span>
            </div>

            <nav className="flex gap-1 overflow-x-auto border-t border-border/60 px-3 py-2 lg:hidden">
              {NAV.map((item) => (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    cn(
                      "whitespace-nowrap px-2 py-1 text-[11px]",
                      isActive
                        ? "bg-foreground text-background"
                        : "text-muted-foreground",
                    )
                  }
                >
                  {item.label}
                </NavLink>
              ))}
            </nav>
          </header>

          <main className="px-4 py-6 sm:px-7 sm:py-8">
            <div className="mb-6 hidden border-b border-border/70 pb-4 lg:block">
              <p className="prose-note max-w-2xl">{subheading}</p>
            </div>
            {me === undefined ? (
              <div className="flex items-center gap-2 py-16 text-sm text-muted-foreground">
                <Loader2 className="size-4 animate-spin" /> Loading workspace…
              </div>
            ) : me === null ? (
              <div className="border border-border p-8">
                <p className="font-serif text-2xl">No demo identity yet.</p>
                <p className="prose-note mt-2 max-w-lg">
                  Your account is signed in but has no workspace membership. Open
                  the demo screen and choose a role.
                </p>
                <Button asChild className="mt-4 rounded-none">
                  <Link to="/demo">Enter the Lumora demo</Link>
                </Button>
              </div>
            ) : (
              children
            )}
          </main>
        </div>
      </div>
    </div>
  );
}
