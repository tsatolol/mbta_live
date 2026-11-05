"use client";
// 表示の明るさの切り替え（005 FR-014・FR-015）。3 つの選択肢のラジオボタンの組
// （WAI-ARIA の radio group: 矢印キーで移り、選んだものだけが Tab で止まる）。
// 選んでいるものは、押された見た目に加えて名前（「Dark」など）も出す（色以外でも分かる）
import { useRef, type KeyboardEvent } from "react";
import { MoonIcon, SunIcon, SystemIcon } from "@/components/icons";
import { useThemePreference } from "@/components/theme/use-theme";
import { THEME_PREFERENCES, type ThemePreference } from "@/lib/theme";
import { cn } from "@/lib/utils";

const OPTIONS: Record<ThemePreference, { label: string; Icon: typeof SunIcon }> = {
  light: { label: "Light", Icon: SunIcon },
  dark: { label: "Dark", Icon: MoonIcon },
  system: { label: "System", Icon: SystemIcon },
};

export function ThemeToggle({
  className,
  testIdPrefix = "theme",
}: {
  className?: string;
  /** data-testid の頭（ヘッダーとメニューの両方に置くので、重ならないようにする） */
  testIdPrefix?: string;
}) {
  const [preference, setPreference] = useThemePreference();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);

  const onKeyDown = (e: KeyboardEvent<HTMLButtonElement>, index: number) => {
    const step =
      e.key === "ArrowRight" || e.key === "ArrowDown"
        ? 1
        : e.key === "ArrowLeft" || e.key === "ArrowUp"
          ? -1
          : 0;
    if (step === 0) return;
    e.preventDefault();
    const next = (index + step + THEME_PREFERENCES.length) % THEME_PREFERENCES.length;
    setPreference(THEME_PREFERENCES[next]!);
    refs.current[next]?.focus();
  };

  return (
    <div
      role="radiogroup"
      aria-label="Color theme"
      data-testid={`${testIdPrefix}-toggle`}
      className={cn(
        "inline-flex items-center rounded-md border border-rule bg-panel p-0.5",
        className,
      )}
    >
      {THEME_PREFERENCES.map((value, index) => {
        const { label, Icon } = OPTIONS[value];
        const checked = preference === value;
        return (
          <button
            key={value}
            ref={(el) => {
              refs.current[index] = el;
            }}
            type="button"
            role="radio"
            aria-checked={checked}
            aria-label={label}
            title={label}
            tabIndex={checked ? 0 : -1}
            onClick={() => setPreference(value)}
            onKeyDown={(e) => onKeyDown(e, index)}
            data-testid={`${testIdPrefix}-${value}`}
            className={cn(
              "inline-flex h-8 items-center gap-1.5 rounded-[4px] px-2 text-xs",
              checked ? "bg-panel-muted font-semibold text-ink" : "text-ink-muted hover:text-ink",
            )}
          >
            <Icon size={16} />
            {checked && <span aria-hidden="true">{label}</span>}
          </button>
        );
      })}
    </div>
  );
}
