import { createFileRoute, Link } from "@tanstack/react-router";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";
import { toast } from "sonner";
import {
  Shield, Play, RefreshCw, ChevronDown, ChevronUp,
  Clock, CheckCircle2, AlertTriangle, Loader2, GitCommit, Eye,
} from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { registeredAgentsQO, versionEventsQO } from "@/lib/queries";
import { triggerAgentEvaluation, updateAgentSchedule, getAgentSessions, getVersionEvents } from "@/lib/api";
import type { RegisteredAgent } from "@/lib/api";

export const Route = createFileRoute("/fleet")({
  head: () => ({
    meta: [{ title: "Fleet Dashboard — Unified Platform" }],
  }),
  component: FleetPage,
});

function tierColor(tier?: string) {
  if (!tier) return "text-muted-foreground";
  const t = tier.toLowerCase();
  if (t === "excellent") return "text-emerald-400";
  if (t === "good") return "text-green-400";
  if (t === "moderate") return "text-amber-400";
  if (t === "poor") return "text-orange-400";
  return "text-red-400";
}

function AgentCard({ agent, versionEvents }: { agent: RegisteredAgent; versionEvents: any[] }) {
  const [expanded, setExpanded] = useState(false);
  const [sessions, setSessions] = useState<any>(null);
  const [loadingSessions, setLoadingSessions] = useState(false);
  const qc = useQueryClient();

  const triggerMut = useMutation({
    mutationFn: () => triggerAgentEvaluation(agent.id),
    onSuccess: (data) => {
      toast.success("Evaluation launched", { description: `Session: ${data.session_id?.slice(0, 8)}...` });
      qc.invalidateQueries({ queryKey: ["registered-agents"] });
    },
    onError: (e: any) => toast.error("Launch failed", { description: e.message }),
  });

  async function loadSessions() {
    if (sessions) { setExpanded(!expanded); return; }
    setLoadingSessions(true);
    try {
      const data = await getAgentSessions(agent.id);
      setSessions(data);
      setExpanded(true);
    } catch (e: any) {
      toast.error("Could not load sessions", { description: e.message });
    } finally {
      setLoadingSessions(false);
    }
  }

  // Find version events for this agent
  const agentVersionEvents = versionEvents.filter(
    (e) => e.agent_name === agent.name && e.status === "triggered"
  );
  const hasNewVersion = agentVersionEvents.length > 0;

  return (
    <Card className="border-border/50">
      <CardContent className="p-4">
        <div className="flex items-start justify-between gap-4">
          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 flex-wrap">
              <h3 className="text-sm font-semibold truncate text-foreground">{agent.name}</h3>
              <span className={`text-xs rounded-full px-2 py-0.5 capitalize font-medium ${
                agent.is_active ? "bg-emerald-500/15 text-emerald-400" : "bg-secondary text-muted-foreground"
              }`}>{agent.is_active ? "active" : "paused"}</span>
              {hasNewVersion && (
                <span className="text-xs rounded-full px-2 py-0.5 bg-violet-500/15 text-violet-400 flex items-center gap-1">
                  <RefreshCw className="h-3 w-3" /> Auto-retested
                </span>
              )}
            </div>
            <p className="text-xs text-muted-foreground font-mono mt-1 truncate">{agent.target_url}</p>
            <div className="flex flex-wrap gap-2 mt-2">
              <span className="text-xs bg-secondary rounded px-2 py-0.5 capitalize">{agent.agent_type}</span>
              <span className="text-xs bg-secondary rounded px-2 py-0.5 capitalize">{agent.domain}</span>
              <span className="text-xs bg-secondary rounded px-2 py-0.5 capitalize">{agent.sensitivity}</span>
              {agent.sync_source === "unified" && (
                <span className="text-xs bg-violet-500/10 text-violet-400 rounded px-2 py-0.5">unified</span>
              )}
            </div>
          </div>

          <div className="flex flex-col items-end gap-2 shrink-0">
            {agent.latest_score !== null && agent.latest_score !== undefined ? (
              <div className="text-right">
                <div className="text-lg font-bold text-foreground">{Math.round(agent.latest_score * 100)}%</div>
                <div className={`text-xs font-medium ${tierColor(agent.latest_tier)}`}>
                  {agent.latest_tier || "—"}
                </div>
              </div>
            ) : (
              <div className="text-xs text-muted-foreground">Not evaluated</div>
            )}
            <div className="flex items-center gap-1.5">
              {agent.latest_session_id && (
                <Button
                  size="sm"
                  variant="outline"
                  className="h-7 text-xs border-violet-500/30 text-violet-400 hover:bg-violet-500/10 gap-1"
                  asChild
                >
                  <Link to="/results" search={{ session: agent.latest_session_id }}>
                    <Eye className="h-3 w-3" />
                    Results
                  </Link>
                </Button>
              )}
              <Button
                size="sm"
                variant="outline"
                className="h-7 text-xs"
                onClick={() => triggerMut.mutate()}
                disabled={triggerMut.isPending}
              >
                {triggerMut.isPending ? <Loader2 className="h-3 w-3 animate-spin" /> : <Play className="h-3 w-3" />}
                Re-run
              </Button>
              <Button
                size="sm"
                variant="ghost"
                className="h-7 text-xs"
                onClick={loadSessions}
                disabled={loadingSessions}
              >
                {loadingSessions ? <Loader2 className="h-3 w-3 animate-spin" /> :
                  expanded ? <ChevronUp className="h-3 w-3" /> : <ChevronDown className="h-3 w-3" />}
                {agent.total_sessions_count}
              </Button>
            </div>
          </div>
        </div>

        {/* Meta row */}
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <Clock className="h-3 w-3" />
            {agent.last_evaluated_at
              ? new Date(agent.last_evaluated_at).toLocaleString()
              : "Never evaluated"}
          </span>
          <span>Every {agent.schedule_interval_minutes}min</span>
          <span>{agent.deployment_countries?.join(", ")}</span>
        </div>

        {/* Version events */}
        {agentVersionEvents.length > 0 && (
          <div className="mt-3 rounded-lg border border-violet-500/20 bg-violet-500/5 p-2">
            <p className="text-xs font-medium text-violet-400 mb-1 flex items-center gap-1">
              <GitCommit className="h-3 w-3" /> Version auto-retests
            </p>
            {agentVersionEvents.slice(0, 3).map((e) => (
              <div key={e.id} className="text-xs text-muted-foreground font-mono">
                v{e.new_version} → session {e.triggered_session_id?.slice(0, 8)}...
              </div>
            ))}
          </div>
        )}

        {/* Sessions list */}
        {expanded && sessions && (
          <div className="mt-3 space-y-1.5 border-t border-border/40 pt-3">
            <p className="text-xs font-semibold text-foreground">{sessions.total_sessions} sessions</p>
            {(sessions.sessions || []).slice(0, 5).map((s: any) => (
              <div key={s.session_id} className="flex items-center gap-2 text-xs rounded-lg border border-border/40 px-2.5 py-1.5 hover:bg-secondary/20 transition-colors">
                <span className={`h-2 w-2 rounded-full shrink-0 ${
                  s.status === "complete" ? "bg-emerald-500" :
                  s.status === "running" ? "bg-violet-500 animate-pulse" :
                  s.status === "failed" ? "bg-red-500" : "bg-amber-500"
                }`} />
                <span className="font-mono text-muted-foreground">{s.session_id.slice(0, 8)}…</span>
                <span className="capitalize text-muted-foreground">{s.trigger_type}</span>
                <span className="ml-auto font-mono">
                  {s.confidence_score ? `${Math.round(s.confidence_score * 100)}%` : "—"}
                </span>
                <Link
                  to="/results"
                  search={{ session: s.session_id }}
                  className="inline-flex items-center gap-1 rounded bg-violet-500/10 px-2 py-0.5 text-[11px] font-medium text-violet-400 hover:bg-violet-500/20 transition-colors ml-1"
                >
                  <Eye className="h-3 w-3" /> Results
                </Link>
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FleetPage() {
  const fleet = useQuery(registeredAgentsQO);
  const vEvents = useQuery(versionEventsQO);
  const qc = useQueryClient();

  const agents = fleet.data || [];
  const versionEvents = vEvents.data || [];
  const activeCount = agents.filter((a) => a.is_active).length;
  const autoRetested = versionEvents.filter((e) => e.status === "triggered").length;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">Fleet Dashboard</h1>
          <p className="text-sm text-muted-foreground">
            All registered agents and their red-team evaluation history. Version changes trigger automatic re-evaluation.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <Button
            variant="outline"
            size="sm"
            className="gap-1.5"
            onClick={() => {
              qc.invalidateQueries({ queryKey: ["registered-agents"] });
              qc.invalidateQueries({ queryKey: ["version-events"] });
            }}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>
          <Button asChild size="sm" className="bg-violet-600 hover:bg-violet-700 text-white gap-1.5">
            <Link to="/register"><Shield className="h-4 w-4" /> Register New</Link>
          </Button>
        </div>
      </div>

      {/* Stats row */}
      <div className="grid grid-cols-3 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4 text-center">
          <div className="text-2xl font-bold text-foreground">{agents.length}</div>
          <div className="text-xs text-muted-foreground">Total agents</div>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4 text-center">
          <div className="text-2xl font-bold text-emerald-400">{activeCount}</div>
          <div className="text-xs text-muted-foreground">Active evaluations</div>
        </div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4 text-center">
          <div className="text-2xl font-bold text-violet-400">{autoRetested}</div>
          <div className="text-xs text-muted-foreground">Auto-retests triggered</div>
        </div>
      </div>

      {/* Agent list */}
      {fleet.isLoading ? (
        <div className="space-y-4">
          {[1, 2, 3].map((i) => <Skeleton key={i} className="h-32" />)}
        </div>
      ) : agents.length === 0 ? (
        <div className="rounded-xl border border-dashed border-border/50 p-12 text-center">
          <Shield className="mx-auto h-12 w-12 text-muted-foreground/40 mb-4" />
          <h3 className="text-lg font-semibold text-foreground">No agents registered</h3>
          <p className="text-sm text-muted-foreground mt-1">
            Use the Register page to add your first agent.
          </p>
          <Button asChild className="mt-4 bg-violet-600 hover:bg-violet-700 text-white">
            <Link to="/register">Register Agent</Link>
          </Button>
        </div>
      ) : (
        <div className="space-y-3">
          {agents.map((agent) => (
            <AgentCard key={agent.id} agent={agent} versionEvents={versionEvents} />
          ))}
        </div>
      )}
    </div>
  );
}
