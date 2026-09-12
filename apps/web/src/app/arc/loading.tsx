export default function ArcLoading() {
  return (
    <div className="arc-route-state" role="status" aria-live="polite" aria-busy="true">
      <span className="arc-route-state__orb" aria-hidden="true" />
      <p className="arc-eyebrow">Arc is getting the next step ready</p>
      <h1>Loading your route…</h1>
    </div>
  );
}
