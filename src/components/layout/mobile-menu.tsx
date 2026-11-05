"use client";
// スマホ（幅 768px 未満）のメニュー（005 US1）: 画面の切り替えと表示の明るさの切り替えを入れる。
// Esc で閉じ、閉じたらメニューのボタンにフォーカスを戻す。画面を移ったら閉じる
import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useId, useRef, useState } from "react";
import { CloseIcon, MenuIcon } from "@/components/icons";
import { cn } from "@/lib/utils";
import { ThemeToggle } from "./theme-toggle";

export function MobileMenu({
  items,
  isActive,
}: {
  items: readonly { href: string; label: string }[];
  isActive: (href: string) => boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();
  const buttonRef = useRef<HTMLButtonElement>(null);
  const panelId = useId();

  // 画面を移ったら閉じる
  const [lastPath, setLastPath] = useState(pathname);
  if (lastPath !== pathname) {
    setLastPath(pathname);
    setOpen(false);
  }

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setOpen(false);
        buttonRef.current?.focus();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open]);

  return (
    <div className="md:hidden">
      <button
        ref={buttonRef}
        type="button"
        aria-expanded={open}
        aria-controls={panelId}
        onClick={() => setOpen((v) => !v)}
        data-testid="menu-button"
        className="inline-flex size-10 items-center justify-center rounded-md text-ink hover:bg-panel-muted"
      >
        {open ? <CloseIcon size={20} /> : <MenuIcon size={20} />}
        <span className="sr-only">{open ? "Close menu" : "Open menu"}</span>
      </button>
      <div
        id={panelId}
        hidden={!open}
        data-testid="menu-panel"
        className="absolute inset-x-0 top-full z-30 border-b border-rule bg-panel px-4 pb-4"
      >
        <nav aria-label="Main">
          <ul>
            {items.map((item) => {
              const active = isActive(item.href);
              return (
                <li key={item.href} className="border-b border-rule">
                  <Link
                    href={item.href}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "block py-3 text-md",
                      active ? "font-extrabold text-ink" : "text-ink",
                    )}
                  >
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        </nav>
        <div className="mt-4 flex items-center justify-between gap-3">
          <span className="text-sm text-ink-muted">Theme</span>
          <ThemeToggle testIdPrefix="menu-theme" />
        </div>
      </div>
    </div>
  );
}
