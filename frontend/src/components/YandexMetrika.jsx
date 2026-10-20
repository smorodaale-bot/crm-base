import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import { trackPublicPage } from '../metrika.js';

export default function YandexMetrika() {
  const { pathname, search } = useLocation();

  useEffect(() => {
    trackPublicPage(pathname, search);
  }, [pathname, search]);

  return null;
}
