import { createFileRoute } from "@tanstack/react-router";
import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import * as api from "@/lib/api";
import { killSwitchesQO } from "@/lib/queries";

export const Route = createFileRoute("/killswitch")({
  component: KillSwitchPage,
});

function KillSwitchPage() {
  const qc = useQueryClient();
  const q = useQuery(killSwitchesQO);
  const [reasons, setReasons] = useState<Record<string, string>>({});
  const [pending, setPending] = useState<Record<string, boolean>>({});

  const mut = useMutation({
    mutationFn: api.setKillSwitch,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["killswitches"] }),
    onError: (e: Error) => toast.error(e.message),
  });

  const items = q.data || [];
  const groups: Record<string, typeof items> = { agent: [], server: [], tool: [] };
  items.forEach((k) => {
    const t = (k.type || "tool").toLowerCase();
    (groups[t] || (groups[t] = [])).push(k);
  });

  const toggle = async (k: api.KillSwitch, enabled: boolean) => {
    setPending((p) => ({ ...p, [k.name]: true }));
    try {
      await mut.mutateAsync({
        name: k.name,
        enabled,
        reason: reasons[k.name] || k.reason || "",
      });
      toast.success(`${k.name} ${enabled ? "enabled" : "disabled"}`);
    } finally {
      setPending((p) => ({ ...p, [k.name]: false }));
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold tracking-tight">Kill-Switch Gateway</h1>
        <p className="text-sm text-muted-foreground">
          Toggle agents, servers, and tools. Enter an audit reason on each flip.
        </p>
      </div>

      {(["agent", "server", "tool"] as const).map((type) => (
        <Card key={type}>
          <CardHeader>
            <CardTitle className="capitalize">
              {type}s{" "}
              <span className="text-sm font-normal text-muted-foreground">
                ({groups[type]?.length || 0})
              </span>
            </CardTitle>
          </CardHeader>
          <CardContent>
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead className="w-64">Reason</TableHead>
                    <TableHead className="w-24 text-right">Enabled</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {q.isLoading && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        Loading…
                      </TableCell>
                    </TableRow>
                  )}
                  {!q.isLoading && (groups[type] || []).length === 0 && (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        None registered.
                      </TableCell>
                    </TableRow>
                  )}
                  {(groups[type] || []).map((k) => (
                    <TableRow key={k.name}>
                      <TableCell className="font-mono text-sm">{k.name}</TableCell>
                      <TableCell>
                        <Input
                          placeholder={k.reason || "Audit reason"}
                          value={reasons[k.name] ?? ""}
                          onChange={(e) =>
                            setReasons((r) => ({ ...r, [k.name]: e.target.value }))
                          }
                        />
                      </TableCell>
                      <TableCell className="text-right">
                        <Switch
                          checked={!!k.enabled}
                          disabled={pending[k.name]}
                          onCheckedChange={(v) => toggle(k, v)}
                        />
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </CardContent>
        </Card>
      ))}
    </div>
  );
}
