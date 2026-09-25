import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import {
  Activity, Package, Shield, ShieldOff, TrendingUp,
  CheckCircle2, XCircle, Clock, ArrowRight, Rocket, RefreshCw,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import {
  pipelineHistoryQO, registryAgentsQO, registeredAgentsQO,
  killSwitchesQO, versionEventsQO,
} from "@/lib/queries";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [{ title: "Overview — Unified Platform" }],
  }),
  component: OverviewPage,
});

function passRateOf(run: any): number | null {
  const v = run.pass_rate_pct ?? run.passRate ?? run.pass_rate ?? run.score;
  if (typeof v !== "number") return null;
  return v > 1 ? v : v * 100;
}

function SummaryCard({ label, value, icon: Icon, gradient, sub }: {
  label: string; value: number | string | null;
  icon: React.ComponentType<any>; gradient: string; sub?: string;
}) {
  return (
    <Card className="relative overflow-hidden border-border/50">
      <CardHeader className="flex flex-row items-center justify-between pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">{label}</CardTitle>
        <div className={`flex h-8 w-8 items-center justify-center rounded-md ${gradient}`}>
          <Icon className="h-4 w-4 text-white" />
        </div>
      </CardHeader>
      <CardContent>
        {value === null ? (
          <Skeleton className="h-8 w-20" />
        ) : (
          <div className="text-3xl font-bold text-foreground">{value}</div>
        )}
        {sub && <p className="mt-1 text-xs text-muted-foreground">{sub}</p>}
      </CardContent>
    </Card>
  );
}

function OverviewPage() {
  const history = useQuery(pipelineHistoryQO);
  const regAgents = useQuery(registryAgentsQO);
  const fleetAgents = useQuery(registeredAgentsQO);
  const killSwitches = useQuery(killSwitchesQO);
  const versionEvents = useQuery(versionEventsQO);

  const recentRuns = (history.data || []).slice(0, 5);
  const rates = recentRuns.map(passRateOf).filter((n): n is number => n !== null);
  const avgRate = rates.length ? Math.round(rates.reduce((a, b) => a + b, 0) / rates.length) : null;
  const lastRun = (history.data || [])[0] || null;

  const activeFleet = (fleetAgents.data || []).filter((a) => a.is_active);
  const recentVersionEvents = (versionEvents.data || []).slice(0, 5);

  return (
    <div className="space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-foreground">Overview</h1>
          <p className="text-sm text-muted-foreground">
            Unified view of registry pipeline and red-team fleet.
          </p>
        </div>
        <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
          <Link to="/register">
            <Rocket className="h-4 w-4" /> Register Agent
          </Link>
        </Button>
      </div>

      {/* Summary cards */}
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        <SummaryCard
          label="Registry Agents" icon={Package}
          value={regAgents.isLoading ? null : regAgents.data?.length ?? 0}
          gradient="bg-gradient-to-br from-violet-500 to-indigo-600"
          sub={`${regAgents.data?.length ?? 0} published`}
        />
        <SummaryCard
          label="Fleet Agents" icon={Shield}
          value={fleetAgents.isLoading ? null : activeFleet.length}
          gradient="bg-gradient-to-br from-emerald-500 to-teal-600"
          sub="Active in red-team fleet"
        />
        <SummaryCard
          label="Kill Switches" icon={ShieldOff}
          value={killSwitches.isLoading ? null : (killSwitches.data?.filter(k => !k.enabled).length ?? 0)}
          gradient="bg-gradient-to-br from-red-500 to-orange-600"
          sub="Components disabled"
        />
        <SummaryCard
          label="Avg Pass Rate" icon={TrendingUp}
          value={history.isLoading ? null : avgRate !== null ? `${avgRate}%` : "—"}
          gradient={avgRate !== null && avgRate >= 75 ? "bg-gradient-to-br from-emerald-500 to-green-600" : "bg-gradient-to-br from-amber-500 to-orange-600"}
          sub={`Last ${rates.length} pipeline runs`}
        />
      </div>

      {/* Last run banner */}
      {lastRun && (
        <div className={[
          "flex items-center gap-3 rounded-xl border px-4 py-3 text-sm",
          lastRun.status === "PUBLISHED" || lastRun.status === "PARTIAL"
            ? "border-emerald-500/30 bg-emerald-500/5 text-emerald-700 dark:text-emerald-300"
            : "border-red-500/30 bg-red-500/5 text-red-700 dark:text-red-300",
        ].join(" ")}>
          {lastRun.status === "PUBLISHED" || lastRun.status === "PARTIAL"
            ? <CheckCircle2 className="h-4 w-4 shrink-0" />
            : <XCircle className="h-4 w-4 shrink-0" />}
          <div className="flex-1 min-w-0">
            <span className="font-semibold">Last pipeline run: </span>
            <span className={`inline-flex items-center rounded px-1.5 py-0.5 text-xs font-mono ${
              lastRun.status === "PUBLISHED" ? "bg-emerald-500/20" : lastRun.status === "PARTIAL" ? "bg-amber-500/20" : "bg-red-500/20"
            }`}>{lastRun.status}</span>
            {lastRun.pass_rate_pct !== undefined && (
              <span className="ml-2 font-mono text-xs opacity-80">{Math.round(lastRun.pass_rate_pct)}% pass rate</span>
            )}
          </div>
          <span className="text-xs opacity-70 shrink-0 flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {lastRun.timestamp ? new Date(lastRun.timestamp).toLocaleString() : ""}
          </span>
        </div>
      )}

      {/* Main content grid */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        {/* Quick actions */}
        <Card className="border-border/50">
          <CardHeader className="pb-3">
            <CardTitle className="text-base">Quick Actions</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {[
              { to: "/register", label: "Register Agent", icon: Rocket, desc: "Unified register + red-team launch" },
              { to: "/pipeline", label: "Pipeline History", icon: Activity, desc: "View registry run history" },
              { to: "/fleet", label: "Fleet Dashboard", icon: Shield, desc: "Manage red-team evaluations" },
              { to: "/catalog", label: "Artifact Catalog", icon: Package, desc: "Browse agents, MCP, skills" },
            ].map(({ to, label, icon: Icon, desc }) => (
              <Link
                key={to} to={to}
                className="flex items-center gap-3 rounded-lg border border-border/50 px-3 py-2.5 hover:bg-accent/50 transition-colors group"
              >
                <div className="flex h-8 w-8 items-center justify-center rounded-md bg-violet-500/10">
                  <Icon className="h-4 w-4 text-violet-500" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="text-sm font-medium">{label}</div>
                  <div className="text-xs text-muted-foreground">{desc}</div>
                </div>
                <ArrowRight className="h-4 w-4 text-muted-foreground opacity-0 group-hover:opacity-100 transition-opacity" />
              </Link>
            ))}
          </CardContent>
        </Card>

        {/* Version events (auto-retests) */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-violet-400" /> Auto-Retests
            </CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link to="/fleet">Fleet</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {versionEvents.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            ) : recentVersionEvents.length === 0 ? (
              <p className="text-sm text-muted-foreground">No version events yet. Triggered when an agent is redeployed.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {recentVersionEvents.map((e) => (
                  <li key={e.id} className="py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-medium truncate">{e.agent_name}</span>
                      <span className={`text-xs rounded px-1.5 py-0.5 ${
                        e.status === "triggered" ? "bg-emerald-500/20 text-emerald-400" :
                        e.status === "skipped" ? "bg-amber-500/20 text-amber-400" :
                        "bg-red-500/20 text-red-400"
                      }`}>{e.status}</span>
                    </div>
                    <div className="text-xs text-muted-foreground font-mono">v{e.new_version}</div>
                  </li>
                ))}
              </ul>
            )}
          </CardContent>
        </Card>

        {/* Recent pipeline runs */}
        <Card className="border-border/50">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle className="text-base">Pipeline Runs</CardTitle>
            <Button asChild size="sm" variant="ghost">
              <Link to="/pipeline">View all</Link>
            </Button>
          </CardHeader>
          <CardContent>
            {history.isLoading ? (
              <div className="space-y-2"><Skeleton className="h-10" /><Skeleton className="h-10" /></div>
            ) : recentRuns.length === 0 ? (
              <p className="text-sm text-muted-foreground">No runs yet.</p>
            ) : (
              <ul className="divide-y divide-border/50">
                {recentRuns.slice(0, 4).map((run: any, i: number) => {
                  const rate = passRateOf(run);
                  return (
                    <li key={run.id || i} className="py-2 space-y-1">
                      <div className="flex items-center justify-between gap-2">
                        <div className="truncate text-sm font-medium">{run.registry_status || run.status || "—"}</div>
                        <span className="text-xs font-mono text-muted-foreground">{rate !== null ? `${Math.round(rate)}%` : ""}</span>
                      </div>
                      {rate !== null && (
                        <div className="h-1 w-full rounded-full bg-secondary overflow-hidden">
                          <div
                            className={`h-1 rounded-full transition-all ${rate >= 75 ? "bg-emerald-500" : "bg-red-400"}`}
                            style={{ width: `${rate}%` }}
                          />
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
