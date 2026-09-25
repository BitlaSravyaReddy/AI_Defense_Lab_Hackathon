import { createFileRoute, useNavigate, Link } from "@tanstack/react-router";
import { useState, useRef } from "react";
import { toast } from "sonner";
import {
  Loader2, Rocket, Upload, GitBranch, Shield, Server,
  Globe, Brain, CheckCircle2, XCircle, ChevronDown, ChevronUp,
  FileText, Info, Cpu, Eye,
} from "lucide-react";
import { unifiedRegister } from "@/lib/api";

export const Route = createFileRoute("/register")({
  head: () => ({
    meta: [
      { title: "Register Agent — Unified Platform" },
      { name: "description", content: "Register an agent to the registry and launch red-team evaluation in one step." },
    ],
  }),
  component: RegisterPage,
});

const AGENT_TYPES = ["rag", "fine_tuned", "agentic", "hybrid"] as const;
const SENSITIVITIES = ["low", "medium", "high", "critical"] as const;
const MODALITIES = ["text", "image", "voice"];
const COUNTRIES = ["us", "eu", "uk", "india", "singapore", "china", "south korea", "australia"];
const DOMAINS = ["finance", "healthcare", "legal", "insurance", "general", "custom"];

function toggle<T>(list: T[], val: T, setter: (v: T[]) => void) {
  setter(list.includes(val) ? list.filter((x) => x !== val) : [...list, val]);
}

function Section({
  title, description, icon: Icon, children, defaultOpen = true,
}: {
  title: string; description?: string; icon: React.ComponentType<any>;
  children: React.ReactNode; defaultOpen?: boolean;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="rounded-xl border border-border/60 bg-card overflow-hidden shadow-sm">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-center gap-3 px-5 py-4 text-left hover:bg-accent/30 transition-colors"
      >
        <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-violet-500/10">
          <Icon className="h-4 w-4 text-violet-500" />
        </div>
        <div className="flex-1">
          <div className="text-sm font-semibold text-foreground">{title}</div>
          {description && <div className="text-xs text-muted-foreground mt-0.5">{description}</div>}
        </div>
        {open ? <ChevronUp className="h-4 w-4 text-muted-foreground" /> : <ChevronDown className="h-4 w-4 text-muted-foreground" />}
      </button>
      {open && <div className="px-5 pb-5 pt-1 space-y-4 border-t border-border/40">{children}</div>}
    </div>
  );
}

function Field({ label, hint, required, children }: { label: string; hint?: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div className="space-y-1.5">
      <label className="block text-sm font-medium text-foreground">
        {label}{required && <span className="ml-1 text-red-400">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-muted-foreground">{hint}</p>}
    </div>
  );
}

function TextInput({ id, placeholder, value, onChange, mono, ...props }: any) {
  return (
    <input
      id={id}
      type="text"
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className={`w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-colors ${mono ? "font-mono" : ""}`}
      {...props}
    />
  );
}

function Textarea({ id, placeholder, value, onChange, rows = 4 }: any) {
  return (
    <textarea
      id={id}
      rows={rows}
      placeholder={placeholder}
      value={value}
      onChange={onChange}
      className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-violet-500/40 focus:border-violet-500 transition-colors resize-none"
    />
  );
}

function Segmented<T extends string>({
  value, options, onChange,
}: { value: T; options: readonly T[] | { value: T; label: string }[]; onChange: (v: T) => void }) {
  const opts = (options as any[]).map((o) =>
    typeof o === "string" ? { value: o, label: o } : o
  );
  return (
    <div className="inline-flex flex-wrap gap-1 rounded-lg border border-border bg-secondary/40 p-1">
      {opts.map((o) => (
        <button
          key={o.value}
          type="button"
          onClick={() => onChange(o.value)}
          className={[
            "rounded-md px-3 py-1.5 text-xs font-medium capitalize transition-colors",
            value === o.value
              ? "bg-violet-600 text-white shadow-sm"
              : "text-muted-foreground hover:text-foreground hover:bg-accent",
          ].join(" ")}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

function Toggle({
  label, description, checked, onChange,
}: { label: string; description?: string; checked: boolean; onChange: (v: boolean) => void }) {
  return (
    <label className="flex cursor-pointer items-center justify-between gap-4 rounded-lg border border-border/50 bg-secondary/20 px-3 py-2.5 hover:bg-accent/30 transition-colors">
      <div>
        <div className="text-sm font-medium text-foreground">{label}</div>
        {description && <div className="text-xs text-muted-foreground">{description}</div>}
      </div>
      <div
        onClick={() => onChange(!checked)}
        className={`relative h-5 w-9 rounded-full transition-colors ${checked ? "bg-violet-600" : "bg-input"}`}
      >
        <span className={`absolute top-0.5 left-0.5 h-4 w-4 rounded-full bg-white shadow transition-transform ${checked ? "translate-x-4" : ""}`} />
      </div>
    </label>
  );
}

function ProgressStep({ label, status }: { label: string; status: "pending" | "active" | "done" | "error" }) {
  return (
    <div className="flex items-center gap-3">
      <div className={`h-6 w-6 rounded-full flex items-center justify-center shrink-0 ${
        status === "done" ? "bg-emerald-500" :
        status === "error" ? "bg-red-500" :
        status === "active" ? "bg-violet-500 animate-pulse" :
        "bg-secondary border border-border"
      }`}>
        {status === "done" && <CheckCircle2 className="h-3.5 w-3.5 text-white" />}
        {status === "error" && <XCircle className="h-3.5 w-3.5 text-white" />}
        {status === "active" && <Loader2 className="h-3.5 w-3.5 text-white animate-spin" />}
      </div>
      <span className={`text-sm ${status === "done" ? "text-emerald-500" : status === "error" ? "text-red-400" : status === "active" ? "text-violet-400" : "text-muted-foreground"}`}>
        {label}
      </span>
    </div>
  );
}

function RegisterPage() {
  const navigate = useNavigate();

  // ── Registry fields ──────────────────────────────────────────────────────────
  const [repoUrl, setRepoUrl] = useState("");
  const [branch, setBranch] = useState("main");
  const [agentNameOverride, setAgentNameOverride] = useState("");
  const [serverNameOverride, setServerNameOverride] = useState("");
  const [skillNamesOverride, setSkillNamesOverride] = useState("");
  const [promptNamesOverride, setPromptNamesOverride] = useState("");

  // ── Red-team profile fields ──────────────────────────────────────────────────
  const [agentDisplayName, setAgentDisplayName] = useState("");
  const [endpointUrl, setEndpointUrl] = useState("");
  const [agentType, setAgentType] = useState<typeof AGENT_TYPES[number]>("rag");
  const [domain, setDomain] = useState("general");
  const [sensitivity, setSensitivity] = useState<typeof SENSITIVITIES[number]>("medium");
  const [processedPii, setProcessedPii] = useState(false);
  const [handlesFinancial, setHandlesFinancial] = useState(false);
  const [handlesMedical, setHandlesMedical] = useState(false);
  const [hasMcp, setHasMcp] = useState(false);
  const [mcpTools, setMcpTools] = useState("");
  const [tasks, setTasks] = useState("");
  const [countries, setCountries] = useState<string[]>(["us"]);
  const [modalities, setModalities] = useState<string[]>(["text"]);
  const [isPublic, setIsPublic] = useState(true);
  const [scheduleInterval, setScheduleInterval] = useState(60);
  const [archCode, setArchCode] = useState("@startuml\nactor User\nUser -> API : POST /chat\n@enduml");
  const [dataflowCode, setDataflowCode] = useState("@startuml\nUser -> LLM : query\nLLM -> VectorDB : retrieval\n@enduml");

  // ── Pass-rate gate files ─────────────────────────────────────────────────────
  const [resultFiles, setResultFiles] = useState<File[]>([]);
  const [threatModelFile, setThreatModelFile] = useState<File | null>(null);
  const [hasThreatModel, setHasThreatModel] = useState(false);
  const resultFileRef = useRef<HTMLInputElement>(null);

  // ── Submission state ─────────────────────────────────────────────────────────
  const [submitting, setSubmitting] = useState(false);
  const [stepStatus, setStepStatus] = useState<{
    publish: "pending" | "active" | "done" | "error";
    register: "pending" | "active" | "done" | "error";
    redteam: "pending" | "active" | "done" | "error";
  }>({ publish: "pending", register: "pending", redteam: "pending" });
  const [result, setResult] = useState<any>(null);


  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();

    if (!repoUrl.trim()) { toast.error("GitHub repo URL is required."); return; }
    if (!endpointUrl.trim()) { toast.error("Target endpoint URL is required."); return; }
    if (!tasks.trim()) { toast.error("Agent tasks description is required."); return; }

    setSubmitting(true);
    setResult(null);
    setStepStatus({ publish: "active", register: "pending", redteam: "pending" });

    try {
      const res = await unifiedRegister({
        repo_url: repoUrl,
        branch,
        agent_name_override: agentNameOverride || undefined,
        server_name_override: serverNameOverride || undefined,
        skill_names_override: skillNamesOverride || undefined,
        prompt_names_override: promptNamesOverride || undefined,
        agent_display_name: agentDisplayName || undefined,
        endpoint_url: endpointUrl,
        agent_type: agentType,
        domain,
        sensitivity,
        processes_pii: processedPii,
        handles_financial: handlesFinancial,
        handles_medical: handlesMedical,
        has_mcp: hasMcp,
        mcp_tools_csv: hasMcp ? mcpTools : "",
        tasks_description: tasks,
        deployment_countries_csv: countries.join(","),
        modalities_csv: modalities.join(","),
        is_public_facing: isPublic,
        schedule_interval_minutes: scheduleInterval,
        arch_code: archCode,
        dataflow_code: dataflowCode,
        has_own_threat_model: hasThreatModel,
        result_files: resultFiles,
        threat_model_file: hasThreatModel ? threatModelFile : null,
      });

      setResult(res);

      setStepStatus({
        publish: res.registry_status === "PUBLISHED" || res.registry_status === "PARTIAL" ? "done" : "error",
        register: res.session_id ? "done" : "error",
        redteam: res.redteam_status === "launched" ? "done" : "error",
      });

      if (res.registry_status === "PUBLISHED" || res.registry_status === "PARTIAL" || res.session_id) {
        toast.success("Agent registered & red-team launched!", {
          description: `Registry: ${res.registry_status} · Session: ${res.session_id?.slice(0, 8)}...`,
        });
        setTimeout(() => navigate({ to: "/fleet" }), 2000);
      } else {
        toast.warning("Registration partial", { description: res.message });
      }
    } catch (err) {
      setStepStatus({ publish: "error", register: "pending", redteam: "pending" });
      toast.error("Registration failed", {
        description: err instanceof Error ? err.message : "Unable to reach backend.",
      });
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="mx-auto max-w-3xl px-2 py-6">
      {/* Header */}
      <div className="mb-8">
        <div className="flex items-center gap-3 mb-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-xl bg-gradient-to-br from-violet-600 to-indigo-600 shadow-lg shadow-violet-500/30">
            <Rocket className="h-5 w-5 text-white" />
          </div>
          <div>
            <h1 className="text-2xl font-bold text-foreground">Register Agent</h1>
            <p className="text-sm text-muted-foreground">
              Publish to the registry and launch red-team evaluation in one step
            </p>
          </div>
        </div>

        {/* Flow diagram */}
        <div className="mt-4 flex items-center gap-2 rounded-xl border border-violet-500/20 bg-violet-500/5 px-4 py-3 text-xs text-muted-foreground overflow-x-auto">
          <span className="font-medium text-violet-400">Flow:</span>
          <span className="rounded bg-secondary px-2 py-0.5">arctl publish</span>
          <span>→</span>
          <span className="rounded bg-secondary px-2 py-0.5">Register fleet</span>
          <span>→</span>
          <span className="rounded bg-secondary px-2 py-0.5">Launch red-team</span>
          <span>→</span>
          <span className="rounded bg-emerald-500/20 text-emerald-400 px-2 py-0.5">Auto schedule</span>
        </div>
      </div>

      <form onSubmit={handleSubmit} className="space-y-4">

        {/* ── Section 1: Source ─────────────────────────────────────────────── */}
        <Section title="Source Repository" description="GitHub repo to pull and publish via arctl" icon={GitBranch}>
          <Field label="GitHub Repo URL" required hint="HTTPS clone URL or local path">
            <TextInput
              id="repoUrl"
              placeholder="https://github.com/org/my-agent"
              value={repoUrl}
              onChange={(e: any) => setRepoUrl(e.target.value)}
              mono
            />
          </Field>
          <Field label="Branch">
            <TextInput id="branch" placeholder="main" value={branch} onChange={(e: any) => setBranch(e.target.value)} mono />
          </Field>
          <div className="grid grid-cols-2 gap-3">
            <Field label="Agent name override">
              <TextInput id="agentName" placeholder="my-agent" value={agentNameOverride} onChange={(e: any) => setAgentNameOverride(e.target.value)} />
            </Field>
            <Field label="Server name override">
              <TextInput id="serverName" placeholder="my-mcp-server" value={serverNameOverride} onChange={(e: any) => setServerNameOverride(e.target.value)} />
            </Field>
            <Field label="Skill names (comma-sep)">
              <TextInput id="skillNames" placeholder="search,summarize" value={skillNamesOverride} onChange={(e: any) => setSkillNamesOverride(e.target.value)} />
            </Field>
            <Field label="Prompt names (comma-sep)">
              <TextInput id="promptNames" placeholder="system-prompt" value={promptNamesOverride} onChange={(e: any) => setPromptNamesOverride(e.target.value)} />
            </Field>
          </div>
        </Section>

        {/* ── Section 2: Agent Target ────────────────────────────────────────── */}
        <Section title="Agent Target" description="The running agent endpoint for red-team traffic" icon={Cpu}>
          <Field label="Agent display name">
            <TextInput id="displayName" placeholder="Customer Support Bot" value={agentDisplayName} onChange={(e: any) => setAgentDisplayName(e.target.value)} />
          </Field>
          <Field label="Target endpoint URL" required hint="The /chat endpoint that will receive adversarial traffic">
            <TextInput id="endpoint" placeholder="https://your-agent.example.com/chat" value={endpointUrl} onChange={(e: any) => setEndpointUrl(e.target.value)} mono />
          </Field>
          <Field label="Agent type">
            <Segmented value={agentType} options={AGENT_TYPES} onChange={setAgentType} />
          </Field>
          <Field label="Modalities">
            <div className="flex flex-wrap gap-2">
              {MODALITIES.map((m) => (
                <label key={m} className="flex cursor-pointer items-center gap-2 text-sm capitalize">
                  <input
                    type="checkbox"
                    className="h-4 w-4 rounded border-input accent-violet-600"
                    checked={modalities.includes(m)}
                    onChange={() => toggle(modalities, m, setModalities)}
                  />
                  {m}
                </label>
              ))}
            </div>
          </Field>
          <Toggle label="Uses MCP Tools" description="Model Context Protocol tool calling" checked={hasMcp} onChange={setHasMcp} />
          {hasMcp && (
            <Field label="MCP tool names (comma-separated)">
              <TextInput id="mcpTools" placeholder="search, calculator, database" value={mcpTools} onChange={(e: any) => setMcpTools(e.target.value)} mono />
            </Field>
          )}
        </Section>

        {/* ── Section 4: Risk Profile ────────────────────────────────────────── */}
        <Section title="Risk Profile" description="Classification used to determine red-team attack intensity" icon={Brain}>
          <div className="grid grid-cols-2 gap-4">
            <Field label="Domain">
              <select
                value={domain}
                onChange={(e) => setDomain(e.target.value)}
                className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
              >
                {DOMAINS.map((d) => <option key={d} value={d} className="capitalize">{d}</option>)}
              </select>
            </Field>
            <Field label="Sensitivity">
              <Segmented value={sensitivity} options={SENSITIVITIES} onChange={setSensitivity} />
            </Field>
          </div>

          <Field label="Agent tasks description" required>
            <Textarea
              id="tasks"
              rows={3}
              placeholder="AI insurance assistant that answers policy questions and assists with claims."
              value={tasks}
              onChange={(e: any) => setTasks(e.target.value)}
            />
          </Field>

          <Field label="Deployment countries">
            <div className="flex flex-wrap gap-2">
              {COUNTRIES.map((c) => {
                const active = countries.includes(c);
                return (
                  <button
                    key={c}
                    type="button"
                    onClick={() => toggle(countries, c, setCountries)}
                    className={[
                      "rounded-full border px-3 py-1 text-xs uppercase tracking-wide transition-colors",
                      active ? "border-violet-500 bg-violet-500/15 text-violet-400" : "border-border text-muted-foreground hover:text-foreground",
                    ].join(" ")}
                  >
                    {c}
                  </button>
                );
              })}
            </div>
          </Field>

          <div className="grid grid-cols-2 gap-2">
            <Toggle label="Public Facing" checked={isPublic} onChange={setIsPublic} />
            <Toggle label="Processes PII" checked={processedPii} onChange={setProcessedPii} />
            <Toggle label="Handles Financial Data" checked={handlesFinancial} onChange={setHandlesFinancial} />
            <Toggle label="Handles Medical Data" checked={handlesMedical} onChange={setHandlesMedical} />
          </div>
        </Section>

        {/* ── Section 5: Schedule ────────────────────────────────────────────── */}
        <Section title="Periodic Evaluation Schedule" description="How often Temporal should automatically re-run red-team evaluations" icon={Globe} defaultOpen={false}>
          <Field label="Evaluation interval" hint="A Temporal Schedule will be created for automatic re-evaluation at this interval">
            <select
              value={scheduleInterval}
              onChange={(e) => setScheduleInterval(Number(e.target.value))}
              className="w-full rounded-lg border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-violet-500/40"
            >
              <option value={1}>Every 1 minute</option>
              <option value={5}>Every 5 minutes</option>
              <option value={15}>Every 15 minutes</option>
              <option value={30}>Every 30 minutes</option>
              <option value={60}>Every 1 hour</option>
              <option value={120}>Every 2 hours</option>
              <option value={360}>Every 6 hours</option>
              <option value={1440}>Every 24 hours</option>
            </select>
          </Field>
          <div className="rounded-lg border border-blue-500/20 bg-blue-500/5 p-3 flex gap-2 text-xs text-muted-foreground">
            <Info className="h-4 w-4 text-blue-400 shrink-0 mt-0.5" />
            <span>Additionally, whenever a new agent version is published to the registry, red-team evaluation will <strong className="text-foreground">automatically re-trigger</strong> for this agent — no manual action required.</span>
          </div>
        </Section>

        {/* ── Section 6: Threat Model ────────────────────────────────────────── */}
        <Section title="Threat Model (Optional)" description="Upload a Threat Dragon v2 JSON to derive STRIDE threats" icon={FileText} defaultOpen={false}>
          <Toggle label="I have my own threat model" description="Threat Dragon v2 .json file" checked={hasThreatModel} onChange={setHasThreatModel} />
          {hasThreatModel && (
            <label className="flex cursor-pointer items-center gap-3 rounded-lg border border-dashed border-border px-4 py-5 text-sm text-muted-foreground hover:border-violet-500/50 transition-colors">
              <Upload className="h-4 w-4" />
              <span>{threatModelFile ? threatModelFile.name : "Choose a .json Threat Dragon file"}</span>
              <input type="file" accept=".json" className="hidden" onChange={(e) => setThreatModelFile(e.target.files?.[0] ?? null)} />
            </label>
          )}
        </Section>

        {/* ── Live Progress ──────────────────────────────────────────────────── */}
        {submitting && (
          <div className="rounded-xl border border-violet-500/20 bg-violet-500/5 p-5 space-y-3">
            <p className="text-sm font-semibold text-foreground">Registration in progress…</p>
            <ProgressStep label="Publishing to registry via arctl" status={stepStatus.publish} />
            <ProgressStep label="Registering agent in red-team fleet" status={stepStatus.register} />
            <ProgressStep label="Launching red-team evaluation" status={stepStatus.redteam} />
          </div>
        )}

        {/* ── Result Banner ──────────────────────────────────────────────────── */}
        {result && !submitting && (
          <div className={`rounded-xl border p-4 ${result.session_id ? "border-emerald-500/30 bg-emerald-500/5" : "border-red-500/30 bg-red-500/5"}`}>
            <div className="flex items-center gap-2 mb-2">
              {result.session_id
                ? <CheckCircle2 className="h-5 w-5 text-emerald-500" />
                : <XCircle className="h-5 w-5 text-red-400" />}
              <span className="font-semibold text-sm">
                {result.session_id ? "Success" : "Failed"}
              </span>
              <span className="ml-auto text-xs font-mono text-muted-foreground">
                Registry: {result.registry_status}
              </span>
            </div>
            <p className="text-xs text-muted-foreground">{result.message}</p>
            {result.session_id && (
              <div className="mt-3 flex items-center justify-between border-t border-border/40 pt-2.5">
                <span className="text-xs font-mono text-violet-400">Session: {result.session_id}</span>
                <Link
                  to="/results"
                  search={{ session: result.session_id }}
                  className="inline-flex items-center gap-1.5 rounded-lg bg-violet-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-700 transition-colors shadow-sm"
                >
                  <Eye className="h-3.5 w-3.5" /> View Red Team Results →
                </Link>
              </div>
            )}
          </div>
        )}

        {/* ── Submit ────────────────────────────────────────────────────────── */}
        <div className="flex justify-end pb-6">
          <button
            type="submit"
            disabled={submitting}
            className="inline-flex items-center gap-2 rounded-xl bg-gradient-to-r from-violet-600 to-indigo-600 px-6 py-3 text-sm font-semibold text-white shadow-lg shadow-violet-500/30 hover:from-violet-700 hover:to-indigo-700 disabled:opacity-60 disabled:cursor-not-allowed transition-all"
          >
            {submitting ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Rocket className="h-4 w-4" />
            )}
            {submitting ? "Registering…" : "Register & Launch Red Team"}
          </button>
        </div>
      </form>
    </div>
  );
}
