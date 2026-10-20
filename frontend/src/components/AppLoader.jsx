import './AppLoader.css';

export function AppLoader({ variant = 'inline', size = 64 }) {
  const mode = variant === 'fullscreen' ? 'fullscreen' : 'inline';
  return (
    <div className={`app-loader app-loader--${mode}`}>
      <svg
        viewBox="0 0 64 64"
        className="nova-loader"
        width={size}
        height={size}
        role="status"
        aria-label="Загрузка"
      >
        <path className="nl-ring" d="M35.19 10.92 A24 24 0 1 0 53.68 29.41 L46.05 31.03 A16.2 16.2 0 1 1 33.57 18.55Z" />
        <path className="nl-star" d="M44.41 3.23 L47.69 16.91 L57.13 20.19 L47.69 23.47 L44.41 37.14 L41.13 23.47 L31.7 20.19 L41.13 16.91Z" />
      </svg>
    </div>
  );
}

export default AppLoader;
