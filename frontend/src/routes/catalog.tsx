import { createFileRoute } from "@tanstack/react-router";
import { useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ExternalLink, Bot, Server, Wrench, MessageSquare, Terminal, Shield, Globe, Cpu, ChevronDown, ChevronUp } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { agentsQO, promptsQO, serversQO, skillsQO, pipelineHistoryQO } from "@/lib/queries";
import { DeployDialog, type DeployPreset } from "@/components/deploy-dialog";

export const Route = createFileRoute("/catalog")({
  component: CatalogPage,
});

type Kind = "agents" | "servers" | "skills" | "prompts";

function CatalogPage() {
  const [tab, setTab] = useState<Kind>("agents");
  const [selected, setSelected] = useState<any | null>(null);
  const [selectedKind, setSelectedKind] = useState<Kind>("agents");
  const [deployOpen, setDeployOpen] = useState(false);
  const [deployPreset, setDeployPreset] = useState<DeployPreset | undefined>();
  const [activeVersion, setActiveVersion] = useState<string>("");
  const [jsonOpen, setJsonOpen] = useState(false);

  const agents = useQuery(agentsQO);
  const servers = useQuery(serversQO);
  const skills = useQuery(skillsQO);
  const prompts = useQuery(promptsQO);
  const history = useQuery(pipelineHistoryQO);

  const source: Record<Kind, ReturnType<typeof useQuery>> = {
    agents,
    servers,
    skills,
    prompts,
  };

  const groupByName = (rawItems: any[]) => {
    const grouped: Record<string, any> = {};
    rawItems.forEach((it) => {
      const key = it.name || it.id || "unnamed";
      if (!grouped[key]) {
        grouped[key] = {
          name: key,
          versions: [],
        };
      }
      grouped[key].versions.push(it);
    });
    
    return Object.values(grouped).map((g: any) => {
      const sorted = [...g.versions].sort((a, b) => {
        const tA = a.updatedAt || a._meta?.["io.modelcontextprotocol.registry/official"]?.publishedAt || "";
        const tB = b.updatedAt || b._meta?.["io.modelcontextprotocol.registry/official"]?.publishedAt || "";
        return tB.localeCompare(tA);
      });
      return {
        ...sorted[0],
        allVersions: sorted,
      };
    });
  };

  useEffect(() => {
    if (selected) {
      setActiveVersion(selected.version || "");
      setJsonOpen(false);
    } else {
      setActiveVersion("");
    }
  }, [selected]);

  useEffect(() => {
    setJsonOpen(false);
  }, [activeVersion]);

  const activeDetails = selected?.allVersions?.find((v: any) => v.version === activeVersion) || selected;
  const deployable = selectedKind === "agents" || selectedKind === "servers";

  const checkValidation = (compName: string, compVersion: string) => {
    const runs: any[] = history.data || [];
    // Extract just the timestamp part from semver-style versions like "1.0.20260721054052"
    const tsSegment = compVersion.includes(".")
      ? compVersion.split(".").slice(2).join("") || compVersion
      : compVersion;
    const vNums = tsSegment.replace(/[^0-9]/g, "");
    const versionClean = compVersion.toLowerCase();

    if (runs.length === 0) {
      return {
        validated: false,
        sourceUrl: null,
        branch: "dev",
        lockReason: "no_runs",
        failedRuns: 0,
        totalRuns: 0,
        bestRate: null as number | null,
      };
    }

    // Find any run whose timestamp aligns with this version, or directly lists this artifact version in deployed_versions
    const matchingRun = runs.find((r: any) => {
      if (!r.passed_threshold) return false;

      // 1. Direct check in deployed_versions
      if (r.deployed_versions) {
        const list = [
          ...(r.deployed_versions.agents || []),
          ...(r.deployed_versions.servers || []),
          ...(r.deployed_versions.skills || []),
          ...(r.deployed_versions.prompts || []),
        ];
        if (list.some((item: any) => item.version === compVersion || item.name === compName)) {
          return true;
        }
      }

      // 2. Direct run_ts match
      if (r.run_ts && tsSegment && r.run_ts === tsSegment) {
        return true;
      }

      // 3. Digit substring match fallback
      const rNums = (r.id || "").replace(/[^0-9]/g, "");
      return (
        versionClean === "latest" ||
        vNums.length === 0 ||
        rNums.includes(vNums) ||
        vNums.includes(rNums.slice(0, 14))
      );
    });

    // Find the closest failed run for the same version to show its pass rate
    const relatedFailedRun = !matchingRun
      ? runs.find((r: any) => {
          const rNums = (r.id || "").replace(/[^0-9]/g, "");
          return rNums.includes(vNums) || vNums.includes(rNums.slice(0, 14));
        })
      : null;

    const bestRate: number | null = relatedFailedRun?.pass_rate_pct ?? null;
    const totalRuns = runs.length;
    const failedRuns = runs.filter((r: any) => !r.passed_threshold).length;

    let lockReason = "not_validated";
    if (!matchingRun) {
      if (relatedFailedRun) lockReason = "below_threshold";
      else lockReason = "version_not_found";
    }

    return {
      validated: !!matchingRun,
      sourceUrl: matchingRun?.source_url || null,
      branch: matchingRun?.branch || "dev",
      lockReason: matchingRun ? null : lockReason,
      failedRuns,
      totalRuns,
      bestRate,
    };
  };

  const validationInfo = activeDetails
    ? checkValidation(activeDetails.name || activeDetails.id, activeDetails.version || "")
    : { validated: false, sourceUrl: null, branch: "dev", lockReason: "no_runs", failedRuns: 0, totalRuns: 0, bestRate: null };
  const isValidated = validationInfo.validated;

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Artifact Catalog</h1>
        <p className="text-sm text-muted-foreground">
          Browse registered agents, MCP servers, skills, and prompts.
        </p>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as Kind)}>
        <TabsList className="grid w-full grid-cols-2 sm:w-auto sm:grid-cols-4">
          <TabsTrigger value="agents">Agents</TabsTrigger>
          <TabsTrigger value="servers">MCP Servers</TabsTrigger>
          <TabsTrigger value="skills">Skills</TabsTrigger>
          <TabsTrigger value="prompts">Prompts</TabsTrigger>
        </TabsList>

        {(["agents", "servers", "skills", "prompts"] as Kind[]).map((k) => {
          const q = source[k];
          const rawData = (q.data as any[] | undefined) || [];
          const items = groupByName(rawData);
          return (
            <TabsContent key={k} value={k} className="mt-4">
              {q.isLoading ? (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }).map((_, i) => (
                    <Skeleton key={i} className="h-40" />
                  ))}
                </div>
              ) : items.length === 0 ? (
                <p className="text-sm text-muted-foreground">No {k} registered yet.</p>
              ) : (
                <div className="grid grid-cols-1 gap-4 md:grid-cols-2 xl:grid-cols-3">
                  {items.map((it, i) => (
                    <Card
                      key={it.name || it.id || i}
                      className="cursor-pointer transition-all hover:-translate-y-1 hover:border-primary/50 hover:shadow-md bg-card/60 backdrop-blur-sm border border-border/60"
                      onClick={() => {
                        setSelected(it);
                        setSelectedKind(k);
                      }}
                    >
                      <CardHeader className="pb-2">
                        <div className="flex items-start justify-between gap-2">
                          <div className="flex items-center gap-2 truncate">
                            {k === "agents" && <Bot className="h-5 w-5 text-emerald-500 shrink-0" />}
                            {k === "servers" && <Server className="h-5 w-5 text-purple-500 shrink-0" />}
                            {k === "skills" && <Wrench className="h-5 w-5 text-sky-500 shrink-0" />}
                            {k === "prompts" && <MessageSquare className="h-5 w-5 text-amber-500 shrink-0" />}
                            <CardTitle className="truncate text-base font-semibold tracking-tight">
                              {it.name || it.id || "unnamed"}
                            </CardTitle>
                          </div>
                          {it.version && (
                            <Badge variant="secondary" className="shrink-0 font-mono text-xs">
                              v{it.version}
                              {it.allVersions && it.allVersions.length > 1 && ` (+${it.allVersions.length - 1})`}
                            </Badge>
                          )}
                        </div>
                      </CardHeader>
                      <CardContent className="space-y-3 text-sm">
                        {it.description && (
                          <p className="line-clamp-2 text-muted-foreground leading-relaxed">{it.description}</p>
                        )}
                        <div className="flex flex-wrap gap-1.5 pt-1">
                          {it.provider && <Badge variant="outline" className="bg-purple-500/5 text-purple-600 dark:text-purple-400 border-purple-500/20">{it.provider}</Badge>}
                          {it.framework && <Badge variant="outline" className="bg-emerald-500/5 text-emerald-600 dark:text-emerald-400 border-emerald-500/20">{it.framework}</Badge>}
                          {it.language && <Badge variant="outline" className="bg-sky-500/5 text-sky-600 dark:text-sky-400 border-sky-500/20 uppercase font-mono text-[10px]">{it.language}</Badge>}
                        </div>
                        {it.repository && it.repository !== "none" && it.repository !== "<none>" && (
                          <a
                            href={typeof it.repository === "object" ? it.repository.url : it.repository}
                            target="_blank"
                            rel="noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="inline-flex items-center gap-1 text-xs text-primary hover:underline font-medium"
                          >
                            Repository <ExternalLink className="h-3 w-3" />
                          </a>
                        )}
                      </CardContent>
                    </Card>
                  ))}
                </div>
              )}
            </TabsContent>
          );
        })}
      </Tabs>

      <Dialog open={!!selected} onOpenChange={(o) => !o && setSelected(null)}>
        <DialogContent className="max-w-2xl max-h-[85vh] overflow-y-auto">
          <DialogHeader>
            <div className="flex items-center gap-2">
              {selectedKind === "agents" && <Bot className="h-6 w-6 text-emerald-500" />}
              {selectedKind === "servers" && <Server className="h-6 w-6 text-purple-500" />}
              {selectedKind === "skills" && <Wrench className="h-6 w-6 text-sky-500" />}
              {selectedKind === "prompts" && <MessageSquare className="h-6 w-6 text-amber-500" />}
              <DialogTitle className="truncate text-xl font-bold">
                {activeDetails?.name || activeDetails?.id || "Artifact"}
              </DialogTitle>
            </div>
            <DialogDescription className="pt-1 capitalize">
              {selectedKind.slice(0, -1)} &middot; version {activeDetails?.version || "—"}
            </DialogDescription>
          </DialogHeader>
          
          {selected && activeDetails && (
            <div className="space-y-5 pt-2">
              {selected.allVersions && selected.allVersions.length > 1 && (
                <div className="flex items-center gap-3 rounded-lg border bg-accent/10 p-3 shadow-sm">
                  <span className="text-sm font-semibold text-muted-foreground">Select Version:</span>
                  <Select value={activeVersion} onValueChange={setActiveVersion}>
                    <SelectTrigger className="w-[200px]">
                      <SelectValue />
                    </SelectTrigger>
                    <SelectContent>
                      {selected.allVersions.map((v: any) => (
                        <SelectItem key={v.version} value={v.version}>
                          {v.version}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              )}

              {/* Validation Status Indicator */}
              {deployable && (
                <div className={`rounded-lg border shadow-sm overflow-hidden ${
                  isValidated
                    ? "border-emerald-200/50 dark:border-emerald-800/40"
                    : "border-rose-200/50 dark:border-rose-800/40"
                }`}>
                  {/* Header bar */}
                  <div className={`flex items-center justify-between px-4 py-3 ${
                    isValidated
                      ? "bg-emerald-50/40 dark:bg-emerald-950/20 text-emerald-800 dark:text-emerald-400"
                      : "bg-rose-50/40 dark:bg-rose-950/20 text-rose-800 dark:text-rose-400"
                  }`}>
                    <div className="flex items-center gap-2">
                      {isValidated ? (
                        <>
                          <Shield className="h-5 w-5 text-emerald-500 shrink-0" />
                          <span className="text-sm font-semibold">Validation Passed (Score &ge; 75%)</span>
                        </>
                      ) : (
                        <>
                          <Shield className="h-5 w-5 text-rose-500 shrink-0 animate-pulse" />
                          <span className="text-sm font-semibold">Deployment Locked</span>
                        </>
                      )}
                    </div>
                    <Badge variant={isValidated ? "default" : "destructive"} className="font-semibold text-xs">
                      {isValidated ? "READY FOR DEPLOY" : "DEPLOYMENT LOCKED"}
                    </Badge>
                  </div>

                  {/* Detailed lock reason panel */}
                  {!isValidated && (
                    <div className="px-4 py-3 space-y-3 bg-rose-50/20 dark:bg-rose-950/10 text-sm">
                      {/* Reason */}
                      <div className="space-y-1">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">Why is it locked?</p>
                        {validationInfo.lockReason === "no_runs" && (
                          <p className="text-foreground/80">
                            No pipeline runs have been recorded yet. This artifact cannot be deployed until it has been validated through the pipeline.
                          </p>
                        )}
                        {validationInfo.lockReason === "below_threshold" && (
                          <p className="text-foreground/80">
                            A pipeline run matching this version was found, but its pass rate was{" "}
                            <span className="font-bold text-rose-600 dark:text-rose-400">
                              {validationInfo.bestRate !== null ? `${Math.round(validationInfo.bestRate)}%` : "below"}
                            </span>{" "}
                            — below the required{" "}
                            <span className="font-bold">75% threshold</span>.
                            Deployment is blocked until a passing run is submitted.
                          </p>
                        )}
                        {validationInfo.lockReason === "version_not_found" && (
                          <p className="text-foreground/80">
                            No pipeline run matching version{" "}
                            <code className="font-mono bg-rose-100 dark:bg-rose-950/40 px-1 rounded text-xs">{activeDetails?.version}</code>{" "}
                            was found in the run history ({validationInfo.totalRuns} run{validationInfo.totalRuns !== 1 ? "s" : ""} recorded,{" "}
                            {validationInfo.failedRuns} failed). The artifact may have been registered outside the pipeline.
                          </p>
                        )}
                        {validationInfo.lockReason === "not_validated" && (
                          <p className="text-foreground/80">
                            This version has not been validated through the pipeline. Run the validation pipeline with this artifact's repository to unlock deployment.
                          </p>
                        )}
                      </div>

                      {/* Steps to unlock */}
                      <div className="space-y-1.5">
                        <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">How to unlock</p>
                        <ol className="space-y-1 text-xs text-foreground/70 list-none">
                          {[
                            "Go to the Pipeline page",
                            "Paste the repository URL or local folder path for this artifact",
                            "Upload your promptfoo or deepteam test results file (JSON or CSV)",
                            "Ensure the test results achieve ≥ 75% pass rate",
                            "Click \"Run Validation & Registry Pipeline\"",
                            "Return here — the Deploy button will be enabled",
                          ].map((step, i) => (
                            <li key={i} className="flex items-start gap-2">
                              <span className="flex h-4 w-4 shrink-0 items-center justify-center rounded-full bg-rose-200 dark:bg-rose-900 text-[10px] font-bold text-rose-700 dark:text-rose-300 mt-0.5">{i + 1}</span>
                              <span>{step}</span>
                            </li>
                          ))}
                        </ol>
                      </div>
                    </div>
                  )}
                </div>
              )}

              {/* GitHub source link */}
              {validationInfo.sourceUrl && (
                <a
                  href={`${validationInfo.sourceUrl}/tree/${validationInfo.branch}`}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex items-center gap-1.5 text-xs text-primary hover:underline font-medium"
                >
                  <ExternalLink className="h-3.5 w-3.5" />
                  View source on GitHub ({validationInfo.branch})
                </a>
              )}

              <div className="flex flex-wrap gap-1.5 pt-1">
                {(activeDetails.prompts || []).map((p: any, i: number) => (
                  <Badge key={i} variant="secondary" className="bg-amber-500/5 text-amber-600 dark:text-amber-400 border border-amber-500/20">prompt: {p.name || p}</Badge>
                ))}
                {(activeDetails.skills || []).map((p: any, i: number) => (
                  <Badge key={i} variant="secondary" className="bg-sky-500/5 text-sky-600 dark:text-sky-400 border border-sky-500/20">skill: {p.name || p}</Badge>
                ))}
                {(activeDetails.mcpServers || activeDetails.mcp || []).map((p: any, i: number) => (
                  <Badge key={i} variant="secondary" className="bg-purple-500/5 text-purple-600 dark:text-purple-400 border border-purple-500/20">mcp: {p.name || p}</Badge>
                ))}
              </div>

              {activeDetails.description && (
                <div className="space-y-1">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Description</span>
                  <p className="text-sm text-foreground/80 leading-relaxed">{activeDetails.description}</p>
                </div>
              )}

              {/* Render custom premium blocks depending on selection kind */}
              {selectedKind === "agents" && (
                <div className="space-y-3">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Agent Parameters</span>
                  <div className="grid grid-cols-2 gap-3 border rounded-lg p-3 bg-accent/5">
                    <div>
                      <span className="text-xs text-muted-foreground block">Model Provider</span>
                      <span className="text-sm font-semibold flex items-center gap-1.5 mt-0.5"><Cpu className="h-4 w-4 text-emerald-500" />{activeDetails.modelProvider || "—"}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Model Name</span>
                      <span className="text-sm font-semibold flex items-center gap-1.5 mt-0.5"><Terminal className="h-4 w-4 text-purple-500" />{activeDetails.modelName || "—"}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Language</span>
                      <span className="text-sm font-semibold flex items-center gap-1.5 mt-0.5 uppercase"><Globe className="h-4 w-4 text-sky-500" />{activeDetails.language || "—"}</span>
                    </div>
                    <div>
                      <span className="text-xs text-muted-foreground block">Framework</span>
                      <span className="text-sm font-semibold flex items-center gap-1.5 mt-0.5 uppercase"><Shield className="h-4 w-4 text-amber-500" />{activeDetails.framework || "—"}</span>
                    </div>
                    <div className="col-span-2 pt-1 border-t">
                      <span className="text-xs text-muted-foreground block">Docker / OCI Image Path</span>
                      <span className="text-xs font-mono bg-zinc-950 text-zinc-300 p-2 rounded block border border-zinc-800 mt-1 select-all">{activeDetails.image || "—"}</span>
                    </div>
                  </div>
                </div>
              )}

              {selectedKind === "prompts" && activeDetails.content && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Prompt Template Content</span>
                  <div className="p-3 border rounded-lg bg-zinc-950 dark:bg-zinc-950 text-zinc-100 border-zinc-800 max-h-48 overflow-auto text-xs font-mono leading-relaxed whitespace-pre-wrap select-all">
                    {activeDetails.content}
                  </div>
                </div>
              )}

              {(selectedKind === "skills" || selectedKind === "servers") && Array.isArray(activeDetails.packages) && activeDetails.packages.length > 0 && (
                <div className="space-y-2">
                  <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider block">Packages & Transport Specifications</span>
                  <div className="divide-y border rounded-lg overflow-hidden bg-accent/5">
                    {activeDetails.packages.map((pkg: any, idx: number) => (
                      <div key={idx} className="p-3 text-xs flex justify-between items-center bg-card/50">
                        <div>
                          <span className="font-mono font-semibold text-foreground block break-all">{pkg.identifier}</span>
                          <span className="text-muted-foreground text-[10px] block mt-0.5">Registry Type: {pkg.registryType}</span>
                        </div>
                        <Badge variant="outline" className="shrink-0 bg-accent/10">Transport: {pkg.transport?.type || "stdio"}</Badge>
                      </div>
                    ))}
                  </div>
                </div>
              )}

              {/* Collapsible JSON schemas */}
              <div className="border rounded-lg overflow-hidden shadow-sm">
                <Button
                  variant="ghost"
                  className="w-full justify-between p-3 rounded-none border-b h-auto font-semibold text-xs"
                  onClick={() => setJsonOpen(!jsonOpen)}
                >
                  <span>TECHNICAL SCHEMA DETAILS (JSON)</span>
                  {jsonOpen ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
                </Button>
                {jsonOpen && (
                  <pre className="max-h-80 overflow-auto bg-zinc-950 text-zinc-100 p-4 font-mono text-xs border-zinc-800 leading-relaxed shadow-inner">
                    {JSON.stringify(activeDetails, null, 2)}
                  </pre>
                )}
              </div>
            </div>
          )}
          
          <DialogFooter className="gap-2">
            <Button variant="outline" onClick={() => setSelected(null)}>
              Close
            </Button>
            {deployable && activeDetails && (
              <Button
                disabled={!isValidated}
                onClick={() => {
                  setDeployPreset({
                    serverName: activeDetails.name || activeDetails.id,
                    version: activeDetails.version || "latest",
                    resourceType: selectedKind === "agents" ? "agent" : "server",
                  });
                  setDeployOpen(true);
                  setSelected(null);
                }}
              >
                Deploy {selectedKind === "agents" ? "Agent" : "Server"}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <DeployDialog open={deployOpen} onOpenChange={setDeployOpen} preset={deployPreset} />
    </div>
  );
}
