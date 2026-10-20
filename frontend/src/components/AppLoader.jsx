import { useEffect, useState } from 'react';
import './AppLoader.css';

function NovaMark() {
  return (
    <svg viewBox="0 0 64 64" className="nova-loader" role="status" aria-label="Загрузка">
      <path className="nl-ring" d="M35.19 10.92 A24 24 0 1 0 53.68 29.41 L46.05 31.03 A16.2 16.2 0 1 1 33.57 18.55Z" />
      <path className="nl-star" d="M44.41 3.23 L47.69 16.91 L57.13 20.19 L47.69 23.47 L44.41 37.14 L41.13 23.47 L31.7 20.19 L41.13 16.91Z" />
    </svg>
  );
}

export function AppLoader({ variant = 'inline' }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    const timer = window.setTimeout(() => setVisible(true), 150);
    return () => window.clearTimeout(timer);
  }, []);

  const mode = variant === 'fullscreen' ? 'fullscreen' : 'inline';
  if (!visible) {
    return <div className={`app-loader app-loader--${mode} is-pending`} aria-hidden="true" />;
  }

  return (
    <div className={`app-loader app-loader--${mode}`}>
      <NovaMark />
    </div>
  );
}

export default AppLoader;
