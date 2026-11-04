// shadcn/ui の共通関数: Tailwind のクラスを結合し、衝突するものは後のほうを残す
import { clsx, type ClassValue } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}
