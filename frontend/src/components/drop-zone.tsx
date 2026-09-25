import { useRef, useState } from "react";
import { Upload } from "lucide-react";
import { cn } from "@/lib/utils";

export function DropZone({
  onFiles,
  disabled,
  accept = ".json,.csv,application/json,text/csv",
}: {
  onFiles: (files: File[]) => void;
  disabled?: boolean;
  accept?: string;
}) {
  const [over, setOver] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  return (
    <div
      onDragOver={(e) => {
        e.preventDefault();
        if (!disabled) setOver(true);
      }}
      onDragLeave={() => setOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setOver(false);
        if (disabled) return;
        const files = Array.from(e.dataTransfer.files);
        if (files.length) onFiles(files);
      }}
      onClick={() => !disabled && ref.current?.click()}
      className={cn(
        "flex cursor-pointer flex-col items-center justify-center gap-3 rounded-lg border-2 border-dashed p-10 text-center transition-colors",
        over ? "border-primary bg-accent" : "border-border",
        disabled && "cursor-not-allowed opacity-60"
      )}
    >
      <Upload className="h-8 w-8 text-muted-foreground" />
      <div className="space-y-1">
        <div className="text-sm font-medium">Drop JSON or CSV files here</div>
        <div className="text-xs text-muted-foreground">or click to browse</div>
      </div>
      <input
        ref={ref}
        type="file"
        multiple
        accept={accept}
        className="hidden"
        disabled={disabled}
        onChange={(e) => {
          const files = Array.from(e.target.files || []);
          if (files.length) onFiles(files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
