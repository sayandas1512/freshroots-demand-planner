export default function Loading() {
  return (
    <div role="status" aria-live="polite" aria-busy="true" className="loading">
      <div className="skeleton skeleton-title" />
      <div className="skeleton skeleton-strip" />
      <div className="skeleton skeleton-block" />
      <div className="skeleton skeleton-block" />
      <span className="sr-only">Loading</span>
    </div>
  );
}
