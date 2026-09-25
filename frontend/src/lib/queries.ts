import { queryOptions } from "@tanstack/react-query";
import {
  getRegistryAgents, getRegistryServers, getSkills, getPrompts,
  getPipelineHistory, getKillSwitches, getRegisteredAgents,
  getDeployments, getVersionEvents, getNotifications, getRedTeamResults,
} from "./api";

export const redTeamResultsQO = (sessionId?: string | null) =>
  queryOptions({
    queryKey: ["redteam-results", sessionId],
    queryFn: () => (sessionId ? getRedTeamResults(sessionId) : Promise.reject(new Error("No session ID"))),
    enabled: Boolean(sessionId),
    staleTime: 30_000,
  });

export const registryAgentsQO = queryOptions({
  queryKey: ["registry-agents"],
  queryFn: getRegistryAgents,
  staleTime: 30_000,
});
export const registryServersQO = queryOptions({
  queryKey: ["registry-servers"],
  queryFn: getRegistryServers,
  staleTime: 30_000,
});
export const skillsQO = queryOptions({
  queryKey: ["skills"],
  queryFn: getSkills,
  staleTime: 30_000,
});
export const promptsQO = queryOptions({
  queryKey: ["prompts"],
  queryFn: getPrompts,
  staleTime: 30_000,
});
export const pipelineHistoryQO = queryOptions({
  queryKey: ["pipeline-history"],
  queryFn: getPipelineHistory,
  staleTime: 15_000,
});
export const killSwitchesQO = queryOptions({
  queryKey: ["kill-switches"],
  queryFn: getKillSwitches,
  staleTime: 10_000,
});
export const registeredAgentsQO = queryOptions({
  queryKey: ["registered-agents"],
  queryFn: getRegisteredAgents,
  staleTime: 20_000,
});
export const deploymentsQO = queryOptions({
  queryKey: ["deployments"],
  queryFn: getDeployments,
  staleTime: 20_000,
});
export const versionEventsQO = queryOptions({
  queryKey: ["version-events"],
  queryFn: () => getVersionEvents(),
  staleTime: 15_000,
});
export const notificationsQO = queryOptions({
  queryKey: ["notifications"],
  queryFn: getNotifications,
  staleTime: 20_000,
});

// ── Aliases for backward compat with copied registry frontend routes ─────────
// catalog.tsx and pipeline.tsx import agentsQO / serversQO from @/lib/queries
export const agentsQO = registryAgentsQO;
export const serversQO = registryServersQO;
