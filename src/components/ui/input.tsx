// shadcn/ui の Input（CLI を使わずに同じ形で置いた）
import type { InputHTMLAttributes } from "react";
import { cn } from "@/lib/utils";

export function Input({
  className,
  type = "text",
  ...props
}: InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      type={type}
      className={cn(
        "flex h-9 w-full rounded-md border border-input bg-panel px-3 py-1 text-sm text-ink",
        "placeholder:text-muted-foreground",
        className,
      )}
      {...props}
    />
  );
}
