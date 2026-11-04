// 共通のフッター: 出典表記（FR-008。MBTA の利用規約と OSM のライセンス表記）
export function Footer() {
  return (
    <footer className="border-t" data-testid="footer">
      <div className="mx-auto flex max-w-6xl flex-wrap gap-x-4 gap-y-1 px-4 py-3 text-xs text-muted-foreground">
        <span>Data provided by MBTA</span>
        <span>© OpenFreeMap © OpenStreetMap contributors</span>
        <span>Times are shown in Boston time (America/New_York).</span>
      </div>
    </footer>
  );
}
