import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { bindLoading } from '../loadingBridge.js';
import { AppLoader } from '../components/AppLoader.jsx';
import './loading.css';

const LoadingContext = createContext(null);

const SHOW_DELAY = 300;
const MIN_VISIBLE = 400;

export function LoadingProvider({ children }) {
  const requests = useRef(new Map());
  const seq = useRef(0);
  const showTimer = useRef(null);
  const hideTimer = useRef(null);
  const visibleRef = useRef(false);
  const shownAt = useRef(0);
  const [barActive, setBarActive] = useState(false);
  const [overlayVisible, setOverlayVisible] = useState(false);

  const recompute = useCallback(() => {
    const items = [...requests.current.values()];
    const any = items.length > 0;
    const overlayWanted = items.some((item) => item.overlay);
    setBarActive(any);

    if (overlayWanted) {
      if (hideTimer.current) {
        clearTimeout(hideTimer.current);
        hideTimer.current = null;
      }
      if (!visibleRef.current && !showTimer.current) {
        showTimer.current = setTimeout(() => {
          showTimer.current = null;
          visibleRef.current = true;
          shownAt.current = Date.now();
          setOverlayVisible(true);
        }, SHOW_DELAY);
      }
      return;
    }

    if (showTimer.current) {
      clearTimeout(showTimer.current);
      showTimer.current = null;
    }
    if (visibleRef.current && !hideTimer.current) {
      const wait = Math.max(0, MIN_VISIBLE - (Date.now() - shownAt.current));
      hideTimer.current = setTimeout(() => {
        hideTimer.current = null;
        visibleRef.current = false;
        setOverlayVisible(false);
      }, wait);
    }
  }, []);

  const start = useCallback((opts = {}) => {
    const id = ++seq.current;
    requests.current.set(id, { overlay: opts.overlay !== false });
    recompute();
    return () => {
      requests.current.delete(id);
      recompute();
    };
  }, [recompute]);

  const stop = useCallback((stopper) => {
    if (typeof stopper === 'function') stopper();
  }, []);

  const withLoading = useCallback((promise, opts) => {
    const end = start(opts);
    return Promise.resolve(promise).finally(end);
  }, [start]);

  useEffect(() => bindLoading(start), [start]);

  useEffect(() => () => {
    clearTimeout(showTimer.current);
    clearTimeout(hideTimer.current);
    bindLoading(null);
  }, []);

  const value = useMemo(
    () => ({ start, stop, withLoading, barActive, overlayVisible }),
    [start, stop, withLoading, barActive, overlayVisible]
  );

  return (
    <LoadingContext.Provider value={value}>
      {children}
      <TopProgressBar active={barActive} />
      <LoadingOverlay open={overlayVisible} />
    </LoadingContext.Provider>
  );
}

export function useLoading() {
  const ctx = useContext(LoadingContext);
  if (!ctx) {
    return {
      start: () => () => {},
      stop: () => {},
      withLoading: (promise) => Promise.resolve(promise),
      barActive: false,
      overlayVisible: false,
    };
  }
  return ctx;
}

/** Overlay while a heavy screen is still fetching. No-op when `active` is false. */
export function useHeavyLoad(active) {
  const { start } = useLoading();
  useEffect(() => {
    if (!active) return undefined;
    return start({ overlay: true });
  }, [active, start]);
}

function TopProgressBar({ active }) {
  const [mode, setMode] = useState('idle');
  const [width, setWidth] = useState(0);

  useEffect(() => {
    if (!active) return undefined;
    setMode('run');
    setWidth(6);
    const frame = requestAnimationFrame(() => setWidth(75));
    return () => cancelAnimationFrame(frame);
  }, [active]);

  useEffect(() => {
    if (active || mode !== 'run') return undefined;
    setMode('done');
    setWidth(100);
    const timer = setTimeout(() => {
      setMode('idle');
      setWidth(0);
    }, 320);
    return () => clearTimeout(timer);
  }, [active, mode]);

  if (mode === 'idle') return null;
  const finishing = mode === 'done';
  return (
    <div
      className={`top-progress${finishing ? ' is-done' : ''}`}
      style={{ width: `${width}%` }}
      role="progressbar"
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={Math.round(width)}
      aria-label="Загрузка"
    />
  );
}

function LoadingOverlay({ open }) {
  const [mounted, setMounted] = useState(false);
  const [shown, setShown] = useState(false);

  useEffect(() => {
    const main = document.querySelector('main');
    if (!main) return undefined;
    if (open) main.setAttribute('aria-busy', 'true');
    else main.removeAttribute('aria-busy');
    return () => main.removeAttribute('aria-busy');
  }, [open]);

  useEffect(() => {
    if (open) {
      setMounted(true);
      const frame = requestAnimationFrame(() => setShown(true));
      return () => cancelAnimationFrame(frame);
    }
    setShown(false);
    const timer = setTimeout(() => setMounted(false), 200);
    return () => clearTimeout(timer);
  }, [open]);

  if (!mounted) return null;
  return (
    <div className={`loading-overlay${shown ? ' is-in' : ''}`} role="presentation">
      <AppLoader size={64} />
    </div>
  );
}
