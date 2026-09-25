import { useEffect, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Loader2, Plus, X } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import * as api from "@/lib/api";
import { agentsQO, serversQO } from "@/lib/queries";

export type DeployPreset = {
  serverName?: string;
  version?: string;
  resourceType?: "agent" | "server";
};

export function DeployDialog({
  open,
  onOpenChange,
  preset,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  preset?: DeployPreset;
}) {
  const qc = useQueryClient();
  const [resourceType, setResourceType] = useState<"agent" | "server">("agent");
  const [name, setName] = useState("");
  const [version, setVersion] = useState("latest");
  const [providerId, setProviderId] = useState("local");
  const [env, setEnv] = useState<Array<{ k: string; v: string }>>([]);

  const agents = useQuery(agentsQO);
  const servers = useQuery(serversQO);
  const options = resourceType === "agent" ? agents.data || [] : servers.data || [];

  useEffect(() => {
    if (open) {
      setResourceType(preset?.resourceType || "agent");
      setName(preset?.serverName || "");
      setVersion(preset?.version || "latest");
      setProviderId("local");
      setEnv([]);
    }
  }, [open, preset]);

  const mut = useMutation({
    mutationFn: api.createDeployment,
    onSuccess: () => {
      toast.success("Deployment started");
      qc.invalidateQueries({ queryKey: ["deployments"] });
      onOpenChange(false);
    },
    onError: (e: Error) => toast.error(e.message),
  });

  const submit = () => {
    if (!name) return toast.error("Select a name");
    const envObj: Record<string, string> = {};
    env.forEach(({ k, v }) => {
      if (k.trim()) envObj[k.trim()] = v;
    });
    mut.mutate({ serverName: name, version, providerId, resourceType, env: envObj });
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-lg">
        <DialogHeader>
          <DialogTitle>New Deployment</DialogTitle>
          <DialogDescription>Deploy an agent or MCP server to a provider.</DialogDescription>
        </DialogHeader>
        <div className="grid gap-4">
          <div className="grid grid-cols-2 gap-3">
            <div className="space-y-2">
              <Label>Resource Type</Label>
              <Select
                value={resourceType}
                onValueChange={(v) => {
                  setResourceType(v as any);
                  setName("");
                }}
              >
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="agent">Agent</SelectItem>
                  <SelectItem value="server">MCP Server</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Name</Label>
              <Select value={name} onValueChange={setName}>
                <SelectTrigger>
                  <SelectValue placeholder="Select..." />
                </SelectTrigger>
                <SelectContent>
                  {Array.from(
                    new Set(options.map((o: any) => o.name || o.id).filter(Boolean) as string[])
                  ).map((n) => (
                    <SelectItem key={n} value={n}>
                      {n}
                    </SelectItem>
                  ))}
                  {name && !options.find((o: any) => (o.name || o.id) === name) && (
                    <SelectItem value={name}>{name}</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label>Version</Label>
              <Input value={version} onChange={(e) => setVersion(e.target.value)} />
            </div>
            <div className="space-y-2">
              <Label>Provider</Label>
              <Input value={providerId} onChange={(e) => setProviderId(e.target.value)} />
            </div>
          </div>
          <div className="space-y-2">
            <div className="flex items-center justify-between">
              <Label>Environment Variables</Label>
              <Button
                type="button"
                size="sm"
                variant="ghost"
                onClick={() => setEnv([...env, { k: "", v: "" }])}
              >
                <Plus className="h-3.5 w-3.5" /> Add
              </Button>
            </div>
            {env.length === 0 && (
              <div className="text-xs text-muted-foreground">No overrides</div>
            )}
            {env.map((row, i) => (
              <div key={i} className="grid grid-cols-[1fr_1fr_auto] gap-2">
                <Input
                  placeholder="KEY"
                  value={row.k}
                  onChange={(e) => {
                    const c = [...env];
                    c[i] = { ...c[i], k: e.target.value };
                    setEnv(c);
                  }}
                />
                <Input
                  placeholder="value"
                  value={row.v}
                  onChange={(e) => {
                    const c = [...env];
                    c[i] = { ...c[i], v: e.target.value };
                    setEnv(c);
                  }}
                />
                <Button
                  type="button"
                  size="icon"
                  variant="ghost"
                  onClick={() => setEnv(env.filter((_, j) => j !== i))}
                >
                  <X className="h-4 w-4" />
                </Button>
              </div>
            ))}
          </div>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)} disabled={mut.isPending}>
            Cancel
          </Button>
          <Button onClick={submit} disabled={mut.isPending}>
            {mut.isPending && <Loader2 className="mr-2 h-4 w-4 animate-spin" />}
            Deploy
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
