import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/utils";

const variants: Record<string, string> = {
  deployed: "bg-primary text-primary-foreground",
  deploying: "bg-secondary text-secondary-foreground animate-pulse",
  failed: "bg-destructive text-destructive-foreground",
  published: "bg-primary text-primary-foreground",
  rejected: "bg-destructive text-destructive-foreground",
  partial: "bg-secondary text-secondary-foreground",
  enabled: "bg-primary text-primary-foreground",
  disabled: "bg-muted text-muted-foreground",
};

export function StatusBadge({ status, className }: { status?: string; className?: string }) {
  const key = (status || "unknown").toLowerCase();
  const cls = variants[key] || "bg-muted text-muted-foreground";
  return (
    <Badge className={cn("uppercase tracking-wide", cls, className)} variant="outline">
      {status || "unknown"}
    </Badge>
  );
}
