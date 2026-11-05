// 共通のフッター: 出典表記（002 FR-008。MBTA の利用規約と OSM のライセンス表記）。文言は変えない（005 FR-012）
export function Footer() {
  return (
    <footer className="border-t border-rule" data-testid="footer">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-5 gap-y-1 px-4 py-3 text-xs text-ink-muted">
        <span>Data provided by MBTA</span>
        <span>© OpenFreeMap © OpenStreetMap contributors</span>
        <span>Times are shown in Boston time (America/New_York).</span>
      </div>
    </footer>
  );
}
