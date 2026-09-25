import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import {
  ChevronDown,
  ChevronRight,
  Loader2,
  CheckCircle2,
  XCircle,
  Circle,
  GitBranch,
  Play,
  Package,
  ExternalLink,
} from "lucide-react";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Progress } from "@/components/ui/progress";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { DropZone } from "@/components/drop-zone";
import { StatusBadge } from "@/components/status-badge";
import * as api from "@/lib/api";
import { pipelineHistoryQO } from "@/lib/queries";

export const Route = createFileRoute("/pipeline")({
  component: PipelinePage,
});

// ── localStorage helpers ────────────────────────────────────────────────────────
const LS_KEY = "pipeline_form_v2";
function loadForm() {
  try {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? JSON.parse(raw) : {};
  } catch { return {}; }
}
function saveForm(data: Record<string, string>) {
  try { localStorage.setItem(LS_KEY, JSON.stringify(data)); } catch {}
}

function passRateOf(run: any): number | null {
  const v = run?.pass_rate_pct ?? run?.passRate ?? run?.pass_rate ?? run?.score;
  if (typeof v !== "number") return null;
  return v > 1 ? v : v * 100;
}

// ── Structured Log Item ─────────────────────────────────────────────────────────
function LogItem({ step }: { step: any }) {
  const [open, setOpen] = useState(false);
  const rc = step.returncode ?? step.returnCode ?? step.code;
  const ok = rc === 0 || rc === undefined;
  const hasDetail = step.stdout || step.stderr;

  // Friendly label
  const cmd: string = step.cmd || step.step || step.name || "step";
  const label = cmd.length > 80 ? cmd.slice(0, 80) + "…" : cmd;

  return (
    <div
      className={[
        "rounded-md border px-3 py-2 text-sm",
        ok
          ? "border-emerald-500/30 bg-emerald-500/5"
          : "border-red-500/30 bg-red-500/5",
      ].join(" ")}
    >
      <button
        className="flex w-full items-start gap-2 text-left"
        onClick={() => hasDetail && setOpen((v) => !v)}
      >
        {rc === undefined ? (
          <Circle className="mt-0.5 h-4 w-4 shrink-0 text-zinc-400" />
        ) : ok ? (
          <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-500" />
        ) : (
          <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-red-500" />
        )}
        <span className="flex-1 font-mono text-xs text-foreground/90 break-all">{label}</span>
        {hasDetail && (
          <span className="shrink-0 text-muted-foreground">
            {open ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
          </span>
        )}
      </button>
      {open && hasDetail && (
        <div className="mt-2 space-y-1.5 pl-6">
          {step.stdout && (
            <pre className="max-h-48 overflow-auto rounded bg-black/60 p-2 font-mono text-[11px] text-emerald-300 whitespace-pre-wrap">
              {step.stdout}
            </pre>
          )}
          {step.stderr && (
            <pre className="max-h-48 overflow-auto rounded bg-black/60 p-2 font-mono text-[11px] text-red-300 whitespace-pre-wrap">
              {step.stderr}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

// ── Deployed Versions Pills ─────────────────────────────────────────────────────
function DeployedVersions({ dv }: { dv: any }) {
  if (!dv) return <span className="text-muted-foreground text-xs">—</span>;
  const all = [
    ...((dv.agents || []).map((a: any) => ({ ...a, kind: "agent" }))),
    ...((dv.servers || []).map((s: any) => ({ ...s, kind: "server" }))),
    ...((dv.skills || []).map((s: any) => ({ ...s, kind: "skill" }))),
    ...((dv.prompts || []).map((p: any) => ({ ...p, kind: "prompt" }))),
  ];
  if (!all.length) return <span className="text-muted-foreground text-xs">—</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {all.map((a, i) => (
        <Badge key={i} variant="secondary" className="font-mono text-[10px]">
          {a.name}@{a.version}
        </Badge>
      ))}
    </div>
  );
}

// ── Main Page ───────────────────────────────────────────────────────────────────
function PipelinePage() {
  const qc = useQueryClient();
  const history = useQuery(pipelineHistoryQO);
  const [consoleOpen, setConsoleOpen] = useState(true);
  const [result, setResult] = useState<any | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);

  // Persisted form state
  const savedForm = loadForm();
  const [location, setLocation] = useState(savedForm.location ?? "/home/bitla/truviq_agentregistry_demo/deepteam_demo/agentregistry/myagent");
  const [branch, setBranch] = useState(savedForm.branch ?? "dev");
  const [agentName, setAgentName] = useState(savedForm.agentName ?? "");
  const [serverName, setServerName] = useState(savedForm.serverName ?? "");
  const [skillNames, setSkillNames] = useState(savedForm.skillNames ?? "");
  const [promptNames, setPromptNames] = useState(savedForm.promptNames ?? "");

  // Persist on every change
  useEffect(() => {
    saveForm({ location, branch, agentName, serverName, skillNames, promptNames });
  }, [location, branch, agentName, serverName, skillNames, promptNames]);

  const runMut = useMutation({
    mutationFn: ({ loc, br, files }: { loc: string; br: string; files: File[] }) => {
      // In the unified platform, publishing goes through /register page.
      // This performs a standalone history-only check for viewing previous runs.
      // For new registrations, use the Register page.
      const fd = new FormData();
      fd.append("location", loc);
      fd.append("branch", br);
      files.forEach((f) => fd.append("files", f, f.name));
      if (agentName) fd.append("agent_name", agentName);
      if (serverName) fd.append("server_name", serverName);
      if (skillNames) fd.append("skill_names", skillNames);
      if (promptNames) fd.append("prompt_names", promptNames);
      return fetch("http://localhost:8050/api/pipeline/run", { method: "POST", body: fd })
        .then((r) => r.json());
    },
    onSuccess: (data) => {
      setResult(data);
      setSelectedFiles([]);
      toast.success("Validation pipeline complete");
      qc.invalidateQueries({ queryKey: ["pipeline-history"] });
      qc.invalidateQueries({ queryKey: ["registry-agents"] });
      qc.invalidateQueries({ queryKey: ["registry-servers"] });
      qc.invalidateQueries({ queryKey: ["skills"] });
      qc.invalidateQueries({ queryKey: ["prompts"] });
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const rate = result ? passRateOf(result) : null;
  const passed = rate !== null && rate >= 75;
  const isRemote = location.startsWith("http://") || location.startsWith("https://") || location.startsWith("git@");
  const logs = result ? (result.logs || result.publish_steps || result.steps || []) : [];

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Validation & Registry Pipeline</h1>
        <p className="text-sm text-muted-foreground">
          Provide the repository location, optional artifact names, and upload test results to validate and publish to the registry.
        </p>
      </div>

      {/* ── Form ── */}
      <Card>
        <CardHeader>
          <CardTitle className="text-lg">Run Gated Import & Validation Pipeline</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {/* Location + Branch */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div className="space-y-1.5 md:col-span-2">
              <Label htmlFor="location" className="font-semibold">
                Source Code Location (Local path or Remote Git URL) <span className="text-destructive">*</span>
              </Label>
              <Input
                id="location"
                placeholder="/absolute/path/to/folder or https://github.com/org/repo"
                value={location}
                onChange={(e) => setLocation(e.target.value)}
                disabled={runMut.isPending}
              />
              <span className="text-[11px] text-muted-foreground block leading-normal">
                Absolute local folder path or HTTPS/SSH Git repository containing `agent.yaml`, `server.json`, etc.
              </span>
            </div>
            <div className="space-y-1.5">
              <Label htmlFor="branch" className="font-semibold flex items-center gap-1">
                <GitBranch className="h-3.5 w-3.5" /> Git Branch / Commit
              </Label>
              <Input
                id="branch"
                placeholder="dev"
                value={branch}
                onChange={(e) => setBranch(e.target.value)}
                disabled={runMut.isPending || !isRemote}
              />
              <span className="text-[11px] text-muted-foreground block leading-normal">
                Checked out branch/tag if remote (default: dev).
              </span>
            </div>
          </div>

          {/* Naming overrides */}
          <div>
            <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-2">
              Artifact Name Overrides (optional — leave blank to auto-detect from code)
            </p>
            <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3">
              <div className="space-y-1">
                <Label htmlFor="agentName" className="text-xs">Agent Name</Label>
                <Input id="agentName" placeholder="my-banking-agent" value={agentName}
                  onChange={(e) => setAgentName(e.target.value)} disabled={runMut.isPending} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="serverName" className="text-xs">MCP Server Name</Label>
                <Input id="serverName" placeholder="my-mcp-server" value={serverName}
                  onChange={(e) => setServerName(e.target.value)} disabled={runMut.isPending} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="skillNames" className="text-xs">Skill Names (comma-sep)</Label>
                <Input id="skillNames" placeholder="skill1, skill2" value={skillNames}
                  onChange={(e) => setSkillNames(e.target.value)} disabled={runMut.isPending} className="h-8 text-sm" />
              </div>
              <div className="space-y-1">
                <Label htmlFor="promptNames" className="text-xs">Prompt Names (comma-sep)</Label>
                <Input id="promptNames" placeholder="prompt1, prompt2" value={promptNames}
                  onChange={(e) => setPromptNames(e.target.value)} disabled={runMut.isPending} className="h-8 text-sm" />
              </div>
            </div>
          </div>

          {/* Results upload */}
          <div className="space-y-2">
            <Label className="font-semibold">
              Validation Test Results File (JSON or CSV) <span className="text-destructive">*</span>
            </Label>
            <DropZone disabled={runMut.isPending} onFiles={(files) => setSelectedFiles(files)} />
            {selectedFiles.length > 0 ? (
              <div className="text-xs text-emerald-600 dark:text-emerald-400 bg-emerald-500/5 p-2.5 rounded border border-emerald-500/20 flex items-center justify-between">
                <span>Selected: <strong>{selectedFiles[0].name}</strong> ({Math.round(selectedFiles[0].size / 1024)} KB)</span>
                <Button size="sm" variant="ghost" className="h-auto py-1 px-2 hover:bg-destructive/10 hover:text-destructive" onClick={() => setSelectedFiles([])}>Remove</Button>
              </div>
            ) : (
              <span className="text-[11px] text-muted-foreground block leading-normal">
                Drag and drop your promptfoo or deepteam output test results file here.
              </span>
            )}
          </div>

          {/* Run button */}
          <div className="pt-2">
            <Button
              className="gap-2"
              onClick={() => {
                if (!location.trim()) return toast.error("Please enter a codebase location");
                if (selectedFiles.length === 0) return toast.error("Validation results file is mandatory");
                runMut.mutate({ loc: location.trim(), br: branch.trim() || "dev", files: selectedFiles });
              }}
              disabled={runMut.isPending}
            >
              {runMut.isPending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Play className="h-4 w-4" />}
              {runMut.isPending ? "Running Pipeline…" : "Run Validation & Registry Pipeline"}
            </Button>
          </div>

          {runMut.isPending && (
            <div className="flex items-center gap-2 text-sm text-muted-foreground animate-pulse">
              <Loader2 className="h-4 w-4 animate-spin text-primary" />
              Validating test results & publishing components…
            </div>
          )}
        </CardContent>
      </Card>

      {/* ── Verdict ── */}
      {result && (
        <Card className={passed ? "border-emerald-500/40" : "border-red-500/40"}>
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <CardTitle>Evaluation Verdict</CardTitle>
            <StatusBadge status={result.status || (passed ? "PUBLISHED" : "REJECTED")} />
          </CardHeader>
          <CardContent className="space-y-4">
            {rate !== null && (
              <div>
                <div className="mb-1.5 flex items-center justify-between text-sm">
                  <span className="text-muted-foreground">Pass rate</span>
                  <span className={`font-mono font-bold ${rate >= 75 ? "text-emerald-600" : "text-red-500"}`}>
                    {Math.round(rate)}%
                  </span>
                </div>
                <Progress value={rate} className={rate >= 75 ? "[&>div]:bg-emerald-500" : "[&>div]:bg-red-500"} />
                <div className="mt-1 flex items-center gap-4 text-xs text-muted-foreground">
                  <span>Threshold: 75%</span>
                  {result.stats && (
                    <span>{result.stats.passed}/{result.stats.evaluated} tests passed</span>
                  )}
                </div>
              </div>
            )}

            {/* Deployed versions */}
            {result.deployed_versions && (
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wider mb-1.5">
                  <Package className="inline h-3.5 w-3.5 mr-1" />
                  Deployed Artifacts
                </p>
                <DeployedVersions dv={result.deployed_versions} />
              </div>
            )}

            {/* Source link */}
            {result.source_url && (
              <a
                href={result.source_url}
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
              >
                View source repository <ExternalLink className="h-3 w-3" />
              </a>
            )}

            {(result.status === "REJECTED" || result.status === "FAILED") && result.rejection_reason && (
              <div className="rounded-md border border-destructive/40 bg-destructive/10 p-3 text-sm">
                <div className="font-semibold text-destructive">{result.status === "REJECTED" ? "Rejected" : "Compilation Error"}</div>
                <div className="text-muted-foreground mt-1">{result.rejection_reason}</div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {/* ── Console Logs ── */}
      {result && logs.length > 0 && (
        <Card>
          <CardHeader
            className="flex cursor-pointer flex-row items-center justify-between pb-3"
            onClick={() => setConsoleOpen((v) => !v)}
          >
            <CardTitle className="flex items-center gap-2 text-base">
              {consoleOpen ? <ChevronDown className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
              Pipeline Steps ({logs.length})
              <Badge variant="outline" className="ml-2 text-xs">
                {logs.filter((l: any) => (l.returncode ?? l.returnCode ?? 0) === 0).length}/{logs.length} succeeded
              </Badge>
            </CardTitle>
          </CardHeader>
          {consoleOpen && (
            <CardContent>
              <div className="max-h-[480px] overflow-y-auto space-y-2 pr-1">
                {logs.map((step: any, i: number) => (
                  <LogItem key={i} step={step} />
                ))}
              </div>
            </CardContent>
          )}
        </Card>
      )}

      {/* ── Run History ── */}
      <Card>
        <CardHeader>
          <CardTitle>Run History</CardTitle>
        </CardHeader>
        <CardContent>
          <div className="overflow-x-auto">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Source / Files</TableHead>
                  <TableHead>Pass Rate</TableHead>
                  <TableHead>Deployed Artifacts</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Timestamp</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.isLoading && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">Loading…</TableCell>
                  </TableRow>
                )}
                {!history.isLoading && (history.data || []).length === 0 && (
                  <TableRow>
                    <TableCell colSpan={5} className="text-center text-muted-foreground">No runs yet.</TableCell>
                  </TableRow>
                )}
                {(history.data || []).map((run: any, i: number) => {
                  const r = passRateOf(run);
                  const files: string[] = Array.isArray(run.files) ? run.files : [run.file || run.fileName || run.id || "—"];
                  const sourceFile = files.find((f: string) => !f.startsWith("code:")) || files[0];
                  const sourceCode = files.find((f: string) => f.startsWith("code:"))?.replace("code:", "");
                  return (
                    <TableRow key={run.id || i}>
                      <TableCell className="max-w-[200px]">
                        <div className="truncate text-xs font-mono">{sourceFile}</div>
                        {sourceCode && (
                          <div className="truncate text-[10px] text-muted-foreground mt-0.5">
                            {run.source_url ? (
                              <a href={run.source_url} target="_blank" rel="noreferrer" className="text-primary hover:underline inline-flex items-center gap-0.5">
                                {sourceCode.split("#")[0].split("/").pop()} <ExternalLink className="h-2.5 w-2.5" />
                              </a>
                            ) : sourceCode}
                          </div>
                        )}
                      </TableCell>
                      <TableCell>
                        {r !== null ? (
                          <div className="space-y-1 min-w-[80px]">
                            <div className={`text-xs font-bold ${r >= 75 ? "text-emerald-600" : "text-red-500"}`}>{Math.round(r)}%</div>
                            <Progress value={r} className={`h-1.5 ${r >= 75 ? "[&>div]:bg-emerald-500" : "[&>div]:bg-red-500"}`} />
                          </div>
                        ) : "—"}
                      </TableCell>
                      <TableCell><DeployedVersions dv={run.deployed_versions} /></TableCell>
                      <TableCell><StatusBadge status={run.status} /></TableCell>
                      <TableCell className="text-muted-foreground text-xs whitespace-nowrap">
                        {run.timestamp ? new Date(run.timestamp).toLocaleString() : "—"}
                      </TableCell>
                    </TableRow>
                  );
                })}
              </TableBody>
            </Table>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
