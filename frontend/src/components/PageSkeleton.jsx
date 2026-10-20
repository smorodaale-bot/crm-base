export function PageSkeleton() {
  return (
    <div className="page-skeleton" aria-busy="true" aria-label="Загрузка">
      <div className="skeleton skeleton-line skeleton-line-lg" />
      <div className="skeleton-row">
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
        <div className="skeleton skeleton-card" />
      </div>
      <div className="skeleton skeleton-block" />
    </div>
  );
}
