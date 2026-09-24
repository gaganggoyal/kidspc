import { describe, expect, it } from 'vitest';
import { CATALOG, localApps } from '@kidpc/shared';
import { headTags, metaFor, publicPages } from './seo';
import { faqs } from './faq';
import { GAMES } from './play/games';
import { BUILDS } from './play/about';

/**
 * What a search engine and a link preview are told about each page.
 *
 * These are the checks a person would otherwise make by hand in Search
 * Console, weeks after a page went live with the site's generic title.
 */
describe('every public page', () => {
  const pages = publicPages();

  it('has its own title and description, of a length a results page shows whole', () => {
    const titles = new Set<string>();
    for (const page of pages) {
      expect(page.title.length, page.path).toBeGreaterThan(10);
      expect(page.title.length, page.path).toBeLessThanOrEqual(75);
      expect(page.description.length, page.path).toBeGreaterThanOrEqual(70);
      expect(page.description.length, page.path).toBeLessThanOrEqual(170);
      expect(titles.has(page.title), `duplicate title ${page.title}`).toBe(false);
      titles.add(page.title);
    }
  });

  it('includes every free game, so each one can be found on its own', () => {
    const paths = pages.map((p) => p.path);
    for (const app of localApps(CATALOG)) expect(paths).toContain(`/try/${app.id}`);
  });

  it('is indexable, with a canonical address and a preview image', () => {
    for (const page of pages) {
      const head = headTags(page);
      expect(page.index).toBe(true);
      expect(head).toContain('rel="canonical"');
      expect(head).toContain('og:image');
    }
  });
});

describe('the signed-in app', () => {
  it('is kept out of search results', () => {
    for (const path of ['/signin', '/household', '/parent', '/kid', '/verify', '/reset']) {
      const meta = metaFor(path);
      expect(meta.index, path).toBe(false);
      expect(headTags(meta)).toContain('noindex');
      expect(headTags(meta)).not.toContain('rel="canonical"');
    }
  });
});

describe('structured data', () => {
  it('cannot close its own script tag, whatever the text says', () => {
    const head = headTags(metaFor('/'));
    const scripts = head.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/g) ?? [];
    expect(scripts.length).toBeGreaterThanOrEqual(4);
    for (const script of scripts) {
      const body = script.replace(/^<script[^>]*>/, '').replace(/<\/script>$/, '');
      expect(body).not.toContain('<');
      expect(() => JSON.parse(body)).not.toThrow();
    }
  });

  it('answers the same questions the page shows', () => {
    const head = headTags(metaFor('/'));
    for (const item of faqs()) expect(head).toContain(JSON.stringify(item.q).slice(1, -1));
  });
});

describe('each free game', () => {
  it('has a game behind it, and a line for the parent about what it builds', () => {
    for (const app of localApps(CATALOG)) {
      expect(GAMES[app.id], app.id).toBeDefined();
      expect(BUILDS[app.id], app.id).toBeTruthy();
    }
  });
});
