import { renderToString } from 'react-dom/server';
import { StaticRouter } from 'react-router-dom/server';
import { AppRoutes } from './App';

/**
 * The build's entry into the app, for writing public pages out as HTML.
 *
 * Built with `vite build --ssr` and run once by scripts/prerender.mjs. Never
 * shipped to a browser. Why: a search engine, a WhatsApp link preview and a
 * television's first paint all read the HTML before any script runs, and until
 * this existed every address on the site answered with the same empty page
 * titled "Online Kids PC".
 */
export function render(url: string): string {
  return renderToString(
    <StaticRouter location={url}>
      <AppRoutes />
    </StaticRouter>,
  );
}

export { headTags, metaFor, publicPages, SITE_URL } from './seo';
export { EXPLAINER } from './explainer';
