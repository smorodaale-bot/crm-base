export function EmptyState({ title, text }) {
  return (
    <div className="empty-state">
      <strong>{title}</strong>
      {text && <p className="muted">{text}</p>}
    </div>
  );
}
