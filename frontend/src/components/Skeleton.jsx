import './Skeleton.css';

export function Skeleton({ variant = 'block' }) {
  if (variant === 'metrics') {
    return (
      <div className="sk" aria-busy="true" aria-label="Загрузка">
        <div className="sk-row">
          <div className="sk-card" />
          <div className="sk-card" />
          <div className="sk-card" />
          <div className="sk-card" />
        </div>
        <div className="sk-block" />
      </div>
    );
  }
  if (variant === 'table') {
    return (
      <div className="sk" aria-busy="true" aria-label="Загрузка">
        {Array.from({ length: 6 }, (_, i) => (
          <div key={i} className="sk-line" />
        ))}
      </div>
    );
  }
  if (variant === 'list') {
    return (
      <div className="sk" aria-busy="true" aria-label="Загрузка">
        {Array.from({ length: 5 }, (_, i) => (
          <div key={i} className="sk-item" />
        ))}
      </div>
    );
  }
  return (
    <div className="sk" aria-busy="true" aria-label="Загрузка">
      <div className="sk-line sk-line-lg" />
      <div className="sk-block" />
    </div>
  );
}
