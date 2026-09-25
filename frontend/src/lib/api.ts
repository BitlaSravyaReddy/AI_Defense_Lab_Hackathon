// Unified Platform API Client
// Targets unified backend on port 8050

const BASE =
  (typeof import.meta !== "undefined" && (import.meta as any).env?.VITE_API_BASE_URL) ||
  "http://localhost:8050";

async function req<T>(path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.body && !(init.body instanceof FormData)
        ? { "Content-Type": "application/json" }
        : {}),
      ...(init?.headers || {}),
    },
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`${res.status} ${res.statusText}: ${text}`);
  }
  const ct = res.headers.get("content-type") || "";
  return ct.includes("application/json") ? res.json() : (res.text() as any);
}

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────
export type RegistryAgent = Record<string, any> & { name?: string; version?: string };
export type PipelineRun = Record<string, any> & {
  id?: string;
  status?: string;
  pass_rate_pct?: number;
  registry_status?: string;
  redteam_status?: string;
  timestamp?: string;
};
export type KillSwitch = { name: string; enabled: boolean; type?: string; reason?: string };

export type RegisteredAgent = {
  id: string;
  name: string;
  target_url: string;
  agent_type: string;
  domain: string;
  sensitivity: string;
  modalities: string[];
  deployment_countries: string[];
  processes_pii: boolean;
  handles_financial: boolean;
  handles_medical: boolean;
  has_mcp: boolean;
  mcp_tools: string[];
  tasks_description?: string;
  schedule_interval_minutes: number;
  is_active: boolean;
  last_evaluated_at?: string;
  sync_source: string;
  created_at: string;
  latest_score?: number;
  latest_tier?: string;
  latest_session_id?: string;
  total_sessions_count: number;
};

export type VersionEvent = {
  id: string;
  agent_name: string;
  new_version: string;
  previous_version?: string;
  endpoint_url?: string;
  triggered_session_id?: string;
  status: string;
  error_message?: string;
  created_at?: string;
};

// ─────────────────────────────────────────────────────────────
// Unified Register (THE main endpoint)
// ─────────────────────────────────────────────────────────────
export interface UnifiedRegisterInput {
  // Registry fields
  repo_url: string;
  branch: string;
  agent_name_override?: string;
  server_name_override?: string;
  skill_names_override?: string;
  prompt_names_override?: string;
  // Red-team profile
  agent_display_name?: string;
  endpoint_url: string;
  agent_type?: string;
  domain?: string;
  sensitivity?: string;
  processes_pii?: boolean;
  handles_financial?: boolean;
  handles_medical?: boolean;
  has_mcp?: boolean;
  mcp_tools_csv?: string;
  tasks_description: string;
  deployment_countries_csv?: string;
  modalities_csv?: string;
  is_public_facing?: boolean;
  schedule_interval_minutes?: number;
  arch_code?: string;
  dataflow_code?: string;
  has_own_threat_model?: boolean;
  // Files
  result_files: File[];
  threat_model_file?: File | null;
}

export const unifiedRegister = (input: UnifiedRegisterInput) => {
  const fd = new FormData();
  fd.append("repo_url", input.repo_url);
  fd.append("branch", input.branch);
  fd.append("endpoint_url", input.endpoint_url);
  fd.append("tasks_description", input.tasks_description);
  if (input.agent_name_override) fd.append("agent_name_override", input.agent_name_override);
  if (input.server_name_override) fd.append("server_name_override", input.server_name_override);
  if (input.skill_names_override) fd.append("skill_names_override", input.skill_names_override);
  if (input.prompt_names_override) fd.append("prompt_names_override", input.prompt_names_override);
  fd.append("agent_display_name", input.agent_display_name || "AI Agent");
  fd.append("agent_type", input.agent_type || "rag");
  fd.append("domain", input.domain || "general");
  fd.append("sensitivity", input.sensitivity || "medium");
  fd.append("processes_pii", String(input.processes_pii ?? false));
  fd.append("handles_financial", String(input.handles_financial ?? false));
  fd.append("handles_medical", String(input.handles_medical ?? false));
  fd.append("has_mcp", String(input.has_mcp ?? false));
  fd.append("mcp_tools_csv", input.mcp_tools_csv || "");
  fd.append("deployment_countries_csv", input.deployment_countries_csv || "us");
  fd.append("modalities_csv", input.modalities_csv || "text");
  fd.append("is_public_facing", String(input.is_public_facing ?? true));
  fd.append("schedule_interval_minutes", String(input.schedule_interval_minutes ?? 60));
  fd.append("arch_code", input.arch_code || "");
  fd.append("dataflow_code", input.dataflow_code || "");
  fd.append("has_own_threat_model", String(input.has_own_threat_model ?? false));
  input.result_files.forEach((f) => fd.append("result_files", f, f.name));
  if (input.threat_model_file) fd.append("threat_model_file", input.threat_model_file);
  return req<any>("/api/v1/agents/unified-register", { method: "POST", body: fd });
};

// ─────────────────────────────────────────────────────────────
// Version Events (auto-retest)
// ─────────────────────────────────────────────────────────────
export const triggerVersionEvent = (agent_name: string, new_version: string, endpoint_url?: string) =>
  req<any>("/api/v1/agents/version-event", {
    method: "POST",
    body: JSON.stringify({ agent_name, new_version, endpoint_url }),
  });

export const getVersionEvents = (agent_name?: string): Promise<VersionEvent[]> => {
  const qs = agent_name ? `?agent_name=${encodeURIComponent(agent_name)}` : "";
  return req<VersionEvent[]>(`/api/v1/agents/version-events${qs}`);
};

// ─────────────────────────────────────────────────────────────
// Registry API
// ─────────────────────────────────────────────────────────────
export const getRegistryAgents = (): Promise<RegistryAgent[]> =>
  req<any>("/api/agents").then((d: any) => (Array.isArray(d) ? d : d.agents || []));
export const getRegistryServers = (): Promise<any[]> =>
  req<any>("/api/servers").then((d: any) => (Array.isArray(d) ? d : d.servers || []));
export const getSkills = (): Promise<any[]> =>
  req<any>("/api/skills").then((d: any) => (Array.isArray(d) ? d : d.skills || []));
export const getPrompts = (): Promise<any[]> =>
  req<any>("/api/prompts").then((d: any) => (Array.isArray(d) ? d : d.prompts || []));
export const getDeployments = (): Promise<any[]> =>
  req<any>("/api/deployments").then((d: any) => (Array.isArray(d) ? d : d.deployments || []));
export const getPipelineHistory = (): Promise<PipelineRun[]> =>
  req<any>("/api/pipeline/history").then((d: any) => (Array.isArray(d) ? d : d.runs || []));

// Kill-switch
export const getKillSwitches = (): Promise<KillSwitch[]> =>
  req<any>("/api/killswitch/all").then((d: any) => (Array.isArray(d) ? d : []));
export const setKillSwitch = (body: { name: string; enabled: boolean; reason?: string }) =>
  req<KillSwitch>("/api/killswitch/set", { method: "POST", body: JSON.stringify(body) });

// ─────────────────────────────────────────────────────────────
// Red-Team Fleet API
// ─────────────────────────────────────────────────────────────
export const getRegisteredAgents = (): Promise<RegisteredAgent[]> =>
  req<RegisteredAgent[]>("/api/v1/registered-agents");

export const triggerAgentEvaluation = (agent_id: string): Promise<any> =>
  req<any>(`/api/v1/registered-agents/${agent_id}/trigger`, { method: "POST" });

export const updateAgentSchedule = (
  agent_id: string,
  interval_minutes: number,
  is_active?: boolean
): Promise<any> =>
  req<any>(`/api/v1/registered-agents/${agent_id}/schedule`, {
    method: "POST",
    body: JSON.stringify({ interval_minutes, is_active }),
  });

export const getAgentSessions = (agent_id: string): Promise<any> =>
  req<any>(`/api/v1/registered-agents/${agent_id}/sessions`);

// ─────────────────────────────────────────────────────────────
// Red-Team Session API
// ─────────────────────────────────────────────────────────────
export const getSessionStatus = (session_id: string): Promise<any> =>
  req<any>(`/api/v1/agents/session/${session_id}/status`);

export const terminateSession = (session_id: string): Promise<any> =>
  req<any>(`/api/v1/agents/session/${session_id}/terminate`, { method: "POST" });

// ─────────────────────────────────────────────────────────────
// Notifications
// ─────────────────────────────────────────────────────────────
export const getNotifications = (): Promise<any[]> =>
  req<any>("/api/v1/notifications").then((d: any) =>
    Array.isArray(d) ? d : d.notifications || []
  );
export const markNotificationRead = (id: string): Promise<any> =>
  req<any>(`/api/v1/notifications/${id}/read`, { method: "POST" });

// ── Deployment helpers (for catalog deploy-dialog compatibility) ──────────────
export type CreateDeploymentBody = {
  serverName: string;
  version: string;
  providerId: string;
  resourceType: "agent" | "server";
  env: Record<string, string>;
};
export const createDeployment = (body: CreateDeploymentBody): Promise<any> =>
  req<any>("/api/deployments", { method: "POST", body: JSON.stringify(body) });

export const deleteDeployment = (id: string): Promise<void> =>
  req<void>(`/api/deployments/${encodeURIComponent(id)}`, { method: "DELETE" });

// ─────────────────────────────────────────────────────────────
// Red-Team Results API
// ─────────────────────────────────────────────────────────────
export type AttackResult = {
  id: string;
  name: string;
  framework: string;
  vulnerability: string;
  description: string;
  score: number;
  passed: boolean;
  cases?: number;
};

export type Plot4AiCategory = {
  id: string;
  name: string;
  score: number;
  threat_level?: string;
  description?: string;
  passed?: boolean;
  attacks_count?: number;
  num_tests?: number;
};

export type LlmMetric = {
  id: string;
  name: string;
  group: string;
  description: string;
  scorer: string;
  score: number;
  passed: boolean;
  cases?: number;
};

export type StandardCompliance = {
  id: string;
  name: string;
  code?: string;
  score: number;
  passed?: boolean;
  description?: string;
  controls_passed?: number;
  controls_tested?: number;
  controls_total?: number;
  country?: string;
};

export type TranscriptItem = {
  id: string;
  framework: string;
  vulnerability: string;
  attack_method: string;
  turn_type?: string;
  turn_index?: number;
  input_prompt: string;
  target_response?: string;
  evaluator_score: number;
  passed: boolean;
  verdict: string;
  reasoning?: string;
  created_at?: string;
};

export type RedTeamResults = {
  session_id: string;
  agent?: {
    id: string;
    name: string;
    target_url: string;
    agent_type: string;
    domain: string;
    sensitivity: string;
    countries?: string[];
  } | null;
  session?: {
    id: string;
    agent_id: string;
    status: string;
    trigger_type: string;
    created_at?: string;
    finished_at?: string;
  } | null;
  attacks: AttackResult[];
  categories: Plot4AiCategory[];
  metrics: LlmMetric[];
  standards: StandardCompliance[];
  country_verdicts: Record<string, any>;
  confidence: number;
  confidence_tier: string;
  total_transcripts: number;
  transcripts?: TranscriptItem[];
};

export const getRedTeamResults = (sessionId: string): Promise<RedTeamResults> =>
  req<RedTeamResults>(`/api/v1/redteam/results/${encodeURIComponent(sessionId)}`);

export const exportJsonUrl = (sessionId: string) =>
  `${BASE}/api/v1/redteam/results/${encodeURIComponent(sessionId)}`;

