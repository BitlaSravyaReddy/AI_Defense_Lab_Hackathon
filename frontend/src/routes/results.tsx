import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useQuery } from "@tanstack/react-query";
import { useState, useMemo } from "react";
import {
  Shield, CheckCircle2, XCircle, AlertTriangle, Download, RefreshCw,
  Search, ExternalLink, ChevronDown, ChevronUp, Copy, Check,
  FileText, Terminal, Layers, Globe, Cpu, ArrowRight, Play, Eye
} from "lucide-react";
import {
  ResponsiveContainer,
  PieChart,
  Pie,
  Cell,
  Tooltip as RechartsTooltip,
  Legend,
  RadarChart,
  Radar,
  PolarGrid,
  PolarAngleAxis,
  PolarRadiusAxis,
} from "recharts";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { redTeamResultsQO, registeredAgentsQO } from "@/lib/queries";
import { exportJsonUrl } from "@/lib/api";
import type { AttackResult, Plot4AiCategory, LlmMetric, StandardCompliance, TranscriptItem } from "@/lib/api";

type SearchParams = {
  session?: string;
  sessionId?: string;
};

export const Route = createFileRoute("/results")({
  validateSearch: (search: Record<string, unknown>): SearchParams => {
    return {
      session: typeof search.session === "string" ? search.session : undefined,
      sessionId: typeof search.sessionId === "string" ? search.sessionId : undefined,
    };
  },
  head: () => ({
    meta: [
      { title: "Red Team Results — Unified Platform" },
      { name: "description", content: "Comprehensive red team security evaluation results, attack transcripts, PLOT4AI risk categories, and regulatory compliance." },
    ],
  }),
  component: ResultsPage,
});

// ── Helpers ──────────────────────────────────────────────────────────────────
function fmt(score: number | null | undefined, digits = 1) {
  if (score === null || score === undefined || Number.isNaN(score)) return "—";
  return score.toFixed(digits);
}

function tierBadge(tier?: string) {
  if (!tier) return { bg: "bg-muted text-muted-foreground border-border", label: "Unknown" };
  const t = tier.toLowerCase();
  if (t.includes("trusted") || t.includes("production ready") || t.includes("excellent")) {
    return { bg: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30", label: tier };
  }
  if (t.includes("moderate") || t.includes("good") || t.includes("warning")) {
    return { bg: "bg-amber-500/15 text-amber-400 border-amber-500/30", label: tier };
  }
  return { bg: "bg-rose-500/15 text-rose-400 border-rose-500/30", label: tier };
}

function scoreColors(score: number) {
  if (score >= 75) return { text: "text-emerald-400", bg: "bg-emerald-500", border: "border-emerald-500/30" };
  if (score >= 50) return { text: "text-amber-400", bg: "bg-amber-500", border: "border-amber-500/30" };
  return { text: "text-rose-400", bg: "bg-rose-500", border: "border-rose-500/30" };
}

function ScoreBar({ score, className = "" }: { score: number; className?: string }) {
  const { text, bg } = scoreColors(score);
  return (
    <div className={`flex items-center gap-2 ${className}`}>
      <div className="h-2 w-full min-w-16 overflow-hidden rounded-full bg-secondary/80">
        <div
          className={`h-full rounded-full transition-all duration-500 ${bg}`}
          style={{ width: `${Math.max(0, Math.min(100, score))}%` }}
        />
      </div>
      <span className={`w-11 shrink-0 text-right font-mono text-xs font-semibold ${text}`}>
        {fmt(score)}%
      </span>
    </div>
  );
}

function StatusBadge({ passed, score }: { passed: boolean; score?: number }) {
  if (passed) {
    return (
      <span className="inline-flex items-center rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-emerald-400">
        PASSED
      </span>
    );
  }
  return (
    <span className="inline-flex items-center rounded-full border border-rose-500/30 bg-rose-500/10 px-2 py-0.5 font-mono text-[11px] font-medium text-rose-400">
      FAILED
    </span>
  );
}

function FrameworkBadge({ framework }: { framework: string }) {
  const isDeepTeam = framework?.toLowerCase() === "deepteam";
  return (
    <span
      className={`inline-flex items-center rounded-md border px-2 py-0.5 text-[11px] font-medium ${
        isDeepTeam
          ? "border-violet-500/30 bg-violet-500/10 text-violet-400"
          : "border-indigo-500/30 bg-indigo-500/10 text-indigo-400"
      }`}
    >
      {isDeepTeam ? "DeepTeam (Dynamic)" : "Promptfoo (Policy)"}
    </span>
  );
}

const COUNTRY_LABELS: Record<string, string> = {
  us: "United States",
  eu: "European Union",
  uk: "United Kingdom",
  india: "India",
  singapore: "Singapore",
  china: "China",
  australia: "Australia",
  global: "Global Standard",
};

// ── Gauge Component ──────────────────────────────────────────────────────────
function ConfidenceGauge({ score, tier }: { score: number; tier: string }) {
  const radius = 80;
  const circumference = Math.PI * radius;
  const offset = circumference * (1 - Math.min(100, Math.max(0, score)) / 100);
  const { text } = scoreColors(score);
  const strokeColor = score >= 75 ? "#10b981" : score >= 50 ? "#f59e0b" : "#f43f5e";

  return (
    <div className="flex flex-col items-center justify-center p-4">
      <div className="relative flex items-center justify-center">
        <svg viewBox="0 0 200 115" className="w-56 h-32">
          {/* Background arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke="currentColor"
            className="text-secondary/80"
            strokeWidth="14"
            strokeLinecap="round"
          />
          {/* Active arc */}
          <path
            d="M 20 100 A 80 80 0 0 1 180 100"
            fill="none"
            stroke={strokeColor}
            strokeWidth="14"
            strokeLinecap="round"
            strokeDasharray={circumference}
            strokeDashoffset={offset}
            style={{ transition: "stroke-dashoffset 1s ease-in-out" }}
          />
        </svg>
        <div className="absolute top-12 flex flex-col items-center">
          <span className={`font-mono text-4xl font-bold tracking-tight ${text}`}>
            {fmt(score)}%
          </span>
          <span className="text-[11px] uppercase tracking-wider text-muted-foreground mt-0.5">
            Confidence Score
          </span>
        </div>
      </div>
      <div className="mt-2 text-center">
        <span className={`inline-block rounded-full border px-3 py-1 text-xs font-semibold ${tierBadge(tier).bg}`}>
          {tier}
        </span>
      </div>
    </div>
  );
}

// ── Transcript Card ─────────────────────────────────────────────────────────
function TranscriptCard({ t, index }: { t: TranscriptItem; index: number }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);

  const copyPrompt = (e: React.MouseEvent) => {
    e.stopPropagation();
    navigator.clipboard.writeText(t.input_prompt);
    setCopied(true);
    toast.success("Prompt copied to clipboard");
    setTimeout(() => setCopied(false), 2000);
  };

  return (
    <div className="rounded-xl border border-border/50 bg-card/60 transition-all hover:border-border overflow-hidden">
      <div
        className="flex cursor-pointer items-center justify-between gap-3 p-4 select-none"
        onClick={() => setOpen(!open)}
      >
        <div className="flex items-center gap-3 min-w-0">
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-secondary text-xs font-mono text-muted-foreground">
            {index + 1}
          </span>
          <FrameworkBadge framework={t.framework} />
          <div className="truncate">
            <span className="text-sm font-semibold text-foreground truncate">{t.vulnerability}</span>
            <span className="text-xs text-muted-foreground font-mono ml-2">({t.attack_method})</span>
          </div>
        </div>
        <div className="flex items-center gap-3 shrink-0">
          <span className="font-mono text-xs text-muted-foreground">
            Score: {Math.round(t.evaluator_score * 100)}%
          </span>
          <StatusBadge passed={t.passed} score={t.evaluator_score * 100} />
          {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
        </div>
      </div>

      {open && (
        <div className="border-t border-border/40 bg-secondary/10 p-4 space-y-3 text-xs">
          {/* Prompt */}
          <div>
            <div className="flex items-center justify-between text-muted-foreground font-semibold mb-1">
              <span className="flex items-center gap-1.5 text-violet-400">
                <Terminal className="h-3.5 w-3.5" /> Adversarial Attack Prompt
              </span>
              <button
                onClick={copyPrompt}
                className="flex items-center gap-1 text-[11px] hover:text-foreground text-muted-foreground transition-colors"
              >
                {copied ? <Check className="h-3 w-3 text-emerald-400" /> : <Copy className="h-3 w-3" />}
                {copied ? "Copied" : "Copy"}
              </button>
            </div>
            <pre className="max-h-40 overflow-auto rounded-lg border border-border/50 bg-black/40 p-3 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
              {t.input_prompt}
            </pre>
          </div>

          {/* Response */}
          {t.target_response && (
            <div>
              <div className="text-muted-foreground font-semibold mb-1 flex items-center gap-1.5 text-indigo-400">
                <Cpu className="h-3.5 w-3.5" /> Agent Response Under Test
              </div>
              <pre className="max-h-40 overflow-auto rounded-lg border border-border/50 bg-black/40 p-3 font-mono text-xs text-zinc-300 whitespace-pre-wrap">
                {t.target_response}
              </pre>
            </div>
          )}

          {/* Reasoning */}
          {t.reasoning && (
            <div className="rounded-lg border border-border/40 bg-background/50 p-2.5">
              <span className="font-semibold text-foreground">Evaluator Verdict Rationale: </span>
              <span className="text-muted-foreground">{t.reasoning}</span>
            </div>
          )}
        </div>
      )}
    </div>
  );
}

// ── Main Results Page ────────────────────────────────────────────────────────
function ResultsPage() {
  const search = Route.useSearch();
  const navigate = useNavigate();
  const fleetQuery = useQuery(registeredAgentsQO);

  // Determine active session ID
  const activeSessionId = search.session || search.sessionId || "";

  // If no session passed in query, find the latest session from fleet
  const agents = fleetQuery.data || [];
  const latestSessionCandidate = useMemo(() => {
    const withSession = agents.find((a) => a.latest_session_id);
    return withSession?.latest_session_id || "";
  }, [agents]);

  const effectiveSessionId = activeSessionId || latestSessionCandidate;

  const resultsQuery = useQuery(redTeamResultsQO(effectiveSessionId || null));
  const data = resultsQuery.data;

  // Filter state for transcripts and attacks
  const [atkFrameworkFilter, setAtkFrameworkFilter] = useState<string>("all");
  const [atkStatusFilter, setAtkStatusFilter] = useState<string>("all");
  const [transcriptSearch, setTranscriptSearch] = useState<string>("");

  const handleSelectSession = (sid: string) => {
    navigate({ to: "/results", search: { session: sid } });
  };

  // If loading or no session selected
  if (fleetQuery.isLoading && !effectiveSessionId) {
    return (
      <div className="space-y-6">
        <Skeleton className="h-10 w-64" />
        <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 md:col-span-2" />
        </div>
      </div>
    );
  }

  if (!effectiveSessionId) {
    return (
      <div className="rounded-xl border border-dashed border-border/60 p-12 text-center space-y-4">
        <Shield className="mx-auto h-12 w-12 text-muted-foreground/40" />
        <h2 className="text-xl font-semibold text-foreground">No Red Teaming Evaluation Selected</h2>
        <p className="text-sm text-muted-foreground max-w-md mx-auto">
          Please run a red-teaming evaluation from the Fleet or Register page to view the comprehensive security report.
        </p>
        <div className="flex justify-center gap-3 pt-2">
          <Button asChild className="bg-violet-600 hover:bg-violet-700 text-white">
            <Link to="/fleet">Go to Fleet Dashboard</Link>
          </Button>
          <Button asChild variant="outline">
            <Link to="/register">Register New Agent</Link>
          </Button>
        </div>
      </div>
    );
  }

  if (resultsQuery.isLoading) {
    return (
      <div className="space-y-6">
        <div className="flex items-center justify-between">
          <Skeleton className="h-8 w-60" />
          <Skeleton className="h-8 w-32" />
        </div>
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
          <Skeleton className="h-64" />
          <Skeleton className="h-64 lg:col-span-2" />
        </div>
        <Skeleton className="h-96" />
      </div>
    );
  }

  if (resultsQuery.isError || !data) {
    return (
      <div className="rounded-xl border border-rose-500/30 bg-rose-500/5 p-8 text-center space-y-3">
        <AlertTriangle className="mx-auto h-10 w-10 text-rose-400" />
        <h2 className="text-lg font-semibold text-foreground">Could Not Load Results</h2>
        <p className="text-sm text-muted-foreground font-mono">
          Session ID: {effectiveSessionId}
        </p>
        <p className="text-xs text-rose-400">
          {(resultsQuery.error as any)?.message || "Session results could not be retrieved from the server."}
        </p>
        <Button
          variant="outline"
          size="sm"
          onClick={() => resultsQuery.refetch()}
          className="gap-2 mt-2"
        >
          <RefreshCw className="h-3.5 w-3.5" /> Retry
        </Button>
      </div>
    );
  }

  // Calculate high level stats
  const totalAttacks = data.attacks.length;
  const passedAttacks = data.attacks.filter((a) => a.passed).length;
  const failedAttacks = totalAttacks - passedAttacks;
  const passRate = totalAttacks > 0 ? (passedAttacks / totalAttacks) * 100 : 0;
  const deepteamAttacks = data.attacks.filter((a) => a.framework?.toLowerCase() === "deepteam");
  const promptfooAttacks = data.attacks.filter((a) => a.framework?.toLowerCase() !== "deepteam");

  // Chart data
  const pieData = [
    { name: "Passed", value: passedAttacks, color: "#10b981" },
    { name: "Failed", value: failedAttacks, color: "#f43f5e" },
  ];

  const radarData = data.categories.map((c) => ({
    name: c.name.length > 14 ? c.name.slice(0, 12) + "…" : c.name,
    full: c.name,
    score: c.score,
  }));

  // Filtered attacks
  const filteredAttacks = data.attacks.filter((a) => {
    if (atkFrameworkFilter !== "all" && a.framework?.toLowerCase() !== atkFrameworkFilter.toLowerCase()) {
      return false;
    }
    if (atkStatusFilter === "passed" && !a.passed) return false;
    if (atkStatusFilter === "failed" && a.passed) return false;
    return true;
  });

  // Filtered transcripts
  const transcripts = data.transcripts || [];
  const filteredTranscripts = transcripts.filter((t) => {
    if (!transcriptSearch) return true;
    const q = transcriptSearch.toLowerCase();
    return (
      t.vulnerability?.toLowerCase().includes(q) ||
      t.attack_method?.toLowerCase().includes(q) ||
      t.input_prompt?.toLowerCase().includes(q) ||
      t.framework?.toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-8 pb-12">
      {/* ── Top Header & Session Switcher ──────────────────────────────────── */}
      <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between border-b border-border/60 pb-5">
        <div>
          <div className="flex items-center gap-2 flex-wrap">
            <h1 className="text-2xl font-bold tracking-tight text-foreground">
              Red Team Evaluation Results
            </h1>
            {data.agent?.name && (
              <Badge variant="outline" className="border-violet-500/40 text-violet-400 bg-violet-500/10">
                {data.agent.name}
              </Badge>
            )}
            <span className="text-xs font-mono text-muted-foreground bg-secondary/80 px-2 py-0.5 rounded">
              Session: {effectiveSessionId.slice(0, 12)}…
            </span>
          </div>
          <p className="text-sm text-muted-foreground mt-1">
            Multilateral security findings: dynamic adversarial probes (DeepTeam), policy checks (Promptfoo), PLOT4AI taxonomy, and LLM metrics.
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap">
          {/* Agent/Session Switcher Dropdown */}
          {agents.length > 0 && (
            <select
              value={effectiveSessionId}
              onChange={(e) => handleSelectSession(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 py-1 text-xs text-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            >
              {agents.map((ag) => (
                ag.latest_session_id && (
                  <option key={ag.id} value={ag.latest_session_id}>
                    {ag.name} ({ag.latest_session_id.slice(0, 8)}…)
                  </option>
                )
              ))}
            </select>
          )}

          <Button
            variant="outline"
            size="sm"
            className="gap-1.5 text-xs"
            onClick={() => resultsQuery.refetch()}
          >
            <RefreshCw className="h-3.5 w-3.5" /> Refresh
          </Button>

          <Button
            variant="outline"
            size="sm"
            asChild
            className="gap-1.5 text-xs"
          >
            <a href={exportJsonUrl(effectiveSessionId)} download={`redteam_results_${effectiveSessionId}.json`}>
              <Download className="h-3.5 w-3.5" /> JSON Export
            </a>
          </Button>
        </div>
      </div>

      {/* ── Hero: Confidence Gauge & Attack Outcome Split ───────────────────── */}
      <div className="grid gap-6 lg:grid-cols-3">
        {/* Left: Composite Confidence Score Gauge */}
        <Card className="border-border/60 bg-card/80 backdrop-blur">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Security Posture
            </CardTitle>
          </CardHeader>
          <CardContent className="pt-0">
            <ConfidenceGauge score={data.confidence} tier={data.confidence_tier} />
            <div className="mt-4 border-t border-border/40 pt-3 text-center text-xs text-muted-foreground">
              Weighted composite across probes (40%), PLOT4AI (30%), LLM metrics (15%), and compliance (15%).
            </div>
          </CardContent>
        </Card>

        {/* Right: Attack Outcome Donut & Probe Breakdown */}
        <Card className="border-border/60 bg-card/80 backdrop-blur lg:col-span-2">
          <CardHeader className="pb-2">
            <div className="flex items-center justify-between">
              <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
                Attack Outcomes Breakdown
              </CardTitle>
              <span className="text-xs text-muted-foreground font-mono">
                {totalAttacks} Total Tests · {data.total_transcripts} Transcripts
              </span>
            </div>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 items-center">
              <div className="h-48 w-full">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie
                      data={pieData}
                      dataKey="value"
                      nameKey="name"
                      innerRadius={45}
                      outerRadius={75}
                      paddingAngle={4}
                    >
                      {pieData.map((entry) => (
                        <Cell key={entry.name} fill={entry.color} stroke="none" />
                      ))}
                    </Pie>
                    <RechartsTooltip
                      contentStyle={{
                        background: "oklch(0.18 0.04 268)",
                        borderColor: "oklch(1 0 0 / 15%)",
                        borderRadius: 8,
                        color: "#fff",
                        fontSize: 12,
                      }}
                    />
                    <Legend />
                  </PieChart>
                </ResponsiveContainer>
              </div>

              {/* Framework Breakdown cards */}
              <div className="space-y-3">
                <div className="rounded-lg border border-violet-500/20 bg-violet-500/5 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-violet-400">Dynamic Adversarial (DeepTeam)</span>
                    <span className="font-mono text-sm font-bold text-foreground">{deepteamAttacks.length} probes</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Passed: {deepteamAttacks.filter((a) => a.passed).length}</span>
                    <span>Failed: {deepteamAttacks.filter((a) => !a.passed).length}</span>
                  </div>
                </div>

                <div className="rounded-lg border border-indigo-500/20 bg-indigo-500/5 p-3.5">
                  <div className="flex items-center justify-between">
                    <span className="text-xs font-semibold text-indigo-400">Policy & Vulnerability (Promptfoo)</span>
                    <span className="font-mono text-sm font-bold text-foreground">{promptfooAttacks.length} checks</span>
                  </div>
                  <div className="mt-2 flex items-center justify-between text-xs text-muted-foreground">
                    <span>Passed: {promptfooAttacks.filter((a) => a.passed).length}</span>
                    <span>Failed: {promptfooAttacks.filter((a) => !a.passed).length}</span>
                  </div>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* ── Stat Cards Row ─────────────────────────────────────────────────── */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
        <div className="rounded-xl border border-border/50 bg-card p-4">
          <span className="text-xs uppercase tracking-wider text-muted-foreground">Total Attacks</span>
          <div className="mt-1 font-mono text-2xl font-bold text-foreground">{totalAttacks}</div>
          <span className="text-[11px] text-muted-foreground">Across all suites</span>
        </div>
        <div className="rounded-xl border border-emerald-500/20 bg-emerald-500/5 p-4">
          <span className="text-xs uppercase tracking-wider text-emerald-400">Passed Probes</span>
          <div className="mt-1 font-mono text-2xl font-bold text-emerald-400">{passedAttacks}</div>
          <span className="text-[11px] text-muted-foreground">Defenses held</span>
        </div>
        <div className="rounded-xl border border-rose-500/20 bg-rose-500/5 p-4">
          <span className="text-xs uppercase tracking-wider text-rose-400">Failed / Breached</span>
          <div className="mt-1 font-mono text-2xl font-bold text-rose-400">{failedAttacks}</div>
          <span className="text-[11px] text-muted-foreground">Vulnerabilities exploited</span>
        </div>
        <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-4">
          <span className="text-xs uppercase tracking-wider text-violet-400">Pass Rate</span>
          <div className="mt-1 font-mono text-2xl font-bold text-foreground">{fmt(passRate)}%</div>
          <span className="text-[11px] text-muted-foreground">{data.total_transcripts} total transcripts</span>
        </div>
      </div>

      {/* ── Attack Results Table ───────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Attack Probe Results</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Aggregated probe performance across DeepTeam adversarial generators and Promptfoo vulnerability assertions.
              </p>
            </div>
            {/* Filters */}
            <div className="flex items-center gap-2">
              <select
                value={atkFrameworkFilter}
                onChange={(e) => setAtkFrameworkFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none"
              >
                <option value="all">All Frameworks</option>
                <option value="deepteam">DeepTeam</option>
                <option value="promptfoo">Promptfoo</option>
              </select>
              <select
                value={atkStatusFilter}
                onChange={(e) => setAtkStatusFilter(e.target.value)}
                className="h-8 rounded-md border border-input bg-background px-2.5 text-xs text-foreground focus:outline-none"
              >
                <option value="all">All Statuses</option>
                <option value="passed">Passed</option>
                <option value="failed">Failed</option>
              </select>
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/40 uppercase tracking-wider text-muted-foreground border-b border-border/40">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Attack / Vulnerability</th>
                  <th className="px-4 py-2.5 font-medium">Framework</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="w-48 px-4 py-2.5 font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Cases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {filteredAttacks.map((a) => (
                  <tr key={a.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3">
                      <div className="font-semibold text-foreground text-sm">{a.name}</div>
                      <div className="font-mono text-[11px] text-muted-foreground">{a.vulnerability}</div>
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <FrameworkBadge framework={a.framework} />
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                      {a.description}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={a.score} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge passed={a.passed} score={a.score} />
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-foreground">
                      {a.cases ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── PLOT4AI Risk Radar & Risk Categories ───────────────────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Radar Chart */}
        <Card className="border-border/60">
          <CardHeader className="pb-2">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              PLOT4AI Threat Radar
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="h-72 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <RadarChart data={radarData} outerRadius="75%">
                  <PolarGrid stroke="rgba(255, 255, 255, 0.15)" />
                  <PolarAngleAxis
                    dataKey="name"
                    tick={{ fill: "#94a3b8", fontSize: 11 }}
                  />
                  <PolarRadiusAxis
                    domain={[0, 100]}
                    tick={{ fill: "#64748b", fontSize: 9 }}
                  />
                  <Radar
                    name="Security Score"
                    dataKey="score"
                    stroke="#8b5cf6"
                    fill="#8b5cf6"
                    fillOpacity={0.35}
                  />
                  <RechartsTooltip
                    contentStyle={{
                      background: "oklch(0.18 0.04 268)",
                      borderColor: "oklch(1 0 0 / 15%)",
                      borderRadius: 8,
                      color: "#fff",
                      fontSize: 12,
                    }}
                  />
                </RadarChart>
              </ResponsiveContainer>
            </div>
          </CardContent>
        </Card>

        {/* Categories Grid */}
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
          {data.categories.map((c) => (
            <Card key={c.id} className="border-border/50 bg-card/60 p-4 flex flex-col justify-between">
              <div>
                <div className="flex items-start justify-between gap-2">
                  <h3 className="text-xs font-semibold text-foreground">{c.name}</h3>
                  <StatusBadge passed={c.passed ?? c.score >= 70} score={c.score} />
                </div>
                <div className="mt-2 flex items-baseline gap-2">
                  <span className={`font-mono text-2xl font-bold ${scoreColors(c.score).text}`}>
                    {fmt(c.score)}%
                  </span>
                </div>
                <ScoreBar score={c.score} className="mt-2" />
              </div>
              <div className="mt-3 text-[11px] text-muted-foreground flex items-center justify-between">
                <span>{c.threat_level ? `Risk: ${c.threat_level}` : "Threat profile"}</span>
                <span>{c.attacks_count ?? c.num_tests ?? 0} mapped tests</span>
              </div>
            </Card>
          ))}
        </div>
      </div>

      {/* ── LLM Architecture Metrics ────────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex items-center justify-between">
            <div>
              <CardTitle className="text-base font-semibold">LLM Quality & Safety Metrics</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Specialized evaluation metrics calibrated to the agent's architecture ({data.agent?.agent_type || "RAG"}).
              </p>
            </div>
            <Badge variant="outline" className="text-xs capitalize font-mono">
              {data.agent?.agent_type || "rag"} agent
            </Badge>
          </div>
        </CardHeader>
        <CardContent className="p-0">
          <div className="overflow-x-auto">
            <table className="w-full text-left text-xs">
              <thead className="bg-secondary/40 uppercase tracking-wider text-muted-foreground border-b border-border/40">
                <tr>
                  <th className="px-4 py-2.5 font-medium">Metric</th>
                  <th className="px-4 py-2.5 font-medium">Group</th>
                  <th className="px-4 py-2.5 font-medium">Scorer</th>
                  <th className="px-4 py-2.5 font-medium">Description</th>
                  <th className="w-48 px-4 py-2.5 font-medium">Score</th>
                  <th className="px-4 py-2.5 font-medium">Status</th>
                  <th className="px-4 py-2.5 font-medium text-right">Cases</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border/30">
                {data.metrics.map((m) => (
                  <tr key={m.id} className="hover:bg-secondary/20 transition-colors">
                    <td className="px-4 py-3 font-semibold text-foreground text-sm whitespace-nowrap">
                      {m.name}
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <span className="rounded bg-secondary px-2 py-0.5 text-xs text-muted-foreground font-medium">
                        {m.group}
                      </span>
                    </td>
                    <td className="px-4 py-3 font-mono text-xs text-violet-400 whitespace-nowrap">
                      {m.scorer}
                    </td>
                    <td className="px-4 py-3 text-muted-foreground max-w-xs truncate">
                      {m.description}
                    </td>
                    <td className="px-4 py-3">
                      <ScoreBar score={m.score} />
                    </td>
                    <td className="px-4 py-3 whitespace-nowrap">
                      <StatusBadge passed={m.passed} score={m.score} />
                    </td>
                    <td className="px-4 py-3 font-mono text-right text-foreground">
                      {m.cases ?? "—"}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </CardContent>
      </Card>

      {/* ── Regulatory Standards & Country Deployment Verdicts ────────────── */}
      <div className="grid gap-6 lg:grid-cols-2">
        {/* Standards */}
        <Card className="border-border/60">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Regulatory Standards Compliance
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 space-y-3">
            {data.standards.map((s) => (
              <div key={s.id} className="rounded-lg border border-border/40 p-3 bg-secondary/10">
                <div className="flex items-start justify-between gap-2">
                  <div>
                    <h4 className="text-sm font-semibold text-foreground">{s.name}</h4>
                    {s.code && <span className="font-mono text-xs text-muted-foreground">{s.code}</span>}
                  </div>
                  <StatusBadge passed={s.passed ?? s.score >= 70} score={s.score} />
                </div>
                {s.description && (
                  <p className="mt-1 text-xs text-muted-foreground line-clamp-2">{s.description}</p>
                )}
                <ScoreBar score={s.score} className="mt-2" />
                <div className="mt-2 text-[11px] text-muted-foreground flex justify-between">
                  <span>{s.country ? `Jurisdiction: ${s.country}` : "Global Framework"}</span>
                  <span>{s.controls_passed ?? 0}/{s.controls_total ?? s.controls_tested ?? 0} controls passed</span>
                </div>
              </div>
            ))}
          </CardContent>
        </Card>

        {/* Country Verdicts */}
        <Card className="border-border/60">
          <CardHeader className="pb-3 border-b border-border/40">
            <CardTitle className="text-sm font-semibold tracking-wide uppercase text-muted-foreground">
              Jurisdictional Deployment Verdicts
            </CardTitle>
          </CardHeader>
          <CardContent className="p-4 grid grid-cols-1 sm:grid-cols-2 gap-3">
            {Object.entries(data.country_verdicts || {}).map(([key, val]) => {
              const countryLabel = COUNTRY_LABELS[key.toLowerCase()] || key.toUpperCase();
              const isCompliant = typeof val === "boolean" ? val : val?.verdict === "COMPLIANT" || val?.passed;
              const reason = typeof val === "string" ? val : val?.reason || (isCompliant ? "Meets compliance criteria." : "Regulatory check flagged concerns.");
              const score = typeof val === "object" && typeof val?.score === "number" ? val.score : undefined;

              return (
                <div key={key} className="rounded-lg border border-border/40 p-3 bg-secondary/10 flex flex-col justify-between">
                  <div>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-foreground flex items-center gap-1.5">
                        <Globe className="h-3.5 w-3.5 text-violet-400" />
                        {countryLabel}
                      </span>
                      <span className={`inline-flex items-center rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${
                        isCompliant
                          ? "border-emerald-500/30 bg-emerald-500/10 text-emerald-400"
                          : "border-rose-500/30 bg-rose-500/10 text-rose-400"
                      }`}>
                        {isCompliant ? "COMPLIANT" : "FLAGGED"}
                      </span>
                    </div>
                    {score !== undefined && <ScoreBar score={score} className="mt-2" />}
                    <p className="mt-2 text-xs text-muted-foreground line-clamp-3">{reason}</p>
                  </div>
                </div>
              );
            })}
          </CardContent>
        </Card>
      </div>

      {/* ── Attack Transcripts Viewer ──────────────────────────────────────── */}
      <Card className="border-border/60">
        <CardHeader className="pb-3 border-b border-border/40">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3">
            <div>
              <CardTitle className="text-base font-semibold">Individual Attack Transcripts</CardTitle>
              <p className="text-xs text-muted-foreground mt-0.5">
                Exact prompt payloads, agent responses, evaluator reasoning, and pass/fail verdicts captured during evaluation.
              </p>
            </div>
            <div className="relative w-full sm:w-64">
              <Search className="absolute left-2.5 top-2.5 h-3.5 w-3.5 text-muted-foreground" />
              <input
                type="text"
                placeholder="Search transcripts…"
                value={transcriptSearch}
                onChange={(e) => setTranscriptSearch(e.target.value)}
                className="h-8 w-full rounded-md border border-input bg-background pl-8 pr-3 text-xs text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-violet-500"
              />
            </div>
          </div>
        </CardHeader>
        <CardContent className="p-4 space-y-2">
          {filteredTranscripts.length === 0 ? (
            <div className="py-8 text-center text-xs text-muted-foreground">
              {transcripts.length === 0
                ? "No individual transcripts recorded for this session yet."
                : "No transcripts matching your search query."}
            </div>
          ) : (
            filteredTranscripts.map((t, idx) => (
              <TranscriptCard key={t.id || idx} t={t} index={idx} />
            ))
          )}
        </CardContent>
      </Card>
    </div>
  );
}
