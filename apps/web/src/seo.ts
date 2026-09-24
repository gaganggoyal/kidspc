import { useEffect } from 'react';
import { useLocation } from 'react-router-dom';
import {
  AGE_BANDS,
  AGE_BAND_SPECS,
  CATALOG,
  CONTACT_EMAIL,
  FOUNDERS,
  PLANS,
  PRODUCT_NAME,
  findApp,
  localApps,
} from '@kidpc/shared';
import { EXPLAINER } from './explainer';
import { faqs } from './faq';

/**
 * What each address is called, and what a search engine is told about it.
 *
 * One table, read three ways: by RouteMeta below as a visitor moves around the
 * app, by the build (prerender.tsx) to write each public page out as HTML with
 * its head already filled in, and by the build again for the sitemap. A page
 * missing from here is a page that is not in the sitemap and has the site's
 * generic title -- which is the right default for the signed-in screens, and
 * the reason every public one is listed.
 */
export const SITE_URL = (import.meta.env.VITE_PUBLIC_URL as string | undefined) ?? 'https://kidspc.online';
export const OG_IMAGE = '/og.png';

export interface PageMeta {
  path: string;
  title: string;
  description: string;
  /** False keeps it out of search results: sign-in, and everything behind it. */
  index: boolean;
  /** Sitemap hints. */
  priority?: number;
  changefreq?: 'daily' | 'weekly' | 'monthly' | 'yearly';
  /** Structured data (schema.org), one object per <script>. */
  jsonLd?: object[];
  /** For the video sitemap: this page carries the explainer. */
  video?: boolean;
}

const SUFFIX = ` | ${PRODUCT_NAME}`;
const ages = () => {
  const bands = AGE_BANDS.map((id) => AGE_BAND_SPECS[id]);
  return { min: bands[0]!.minAge, max: bands[bands.length - 1]!.maxAge };
};

const organization = () => ({
  '@context': 'https://schema.org',
  '@type': 'Organization',
  '@id': `${SITE_URL}/#organization`,
  name: PRODUCT_NAME,
  url: SITE_URL,
  logo: `${SITE_URL}/icon-512.png`,
  email: CONTACT_EMAIL,
  areaServed: 'IN',
  founder: FOUNDERS.map((f) => ({ '@type': 'Person', name: f.name, jobTitle: f.role })),
});

const breadcrumbs = (trail: Array<[string, string]>) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: trail.map(([name, path], i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name,
    item: `${SITE_URL}${path}`,
  })),
});

/** ISO 8601, which is what VideoObject wants: 94 -> "PT1M34S". */
const isoDuration = (seconds: number) =>
  `PT${Math.floor(seconds / 60)}M${Math.round(seconds % 60)}S`;

export const videoObject = () => ({
  '@context': 'https://schema.org',
  '@type': 'VideoObject',
  name: EXPLAINER.title,
  description: EXPLAINER.description,
  thumbnailUrl: [`${SITE_URL}${EXPLAINER.poster}`],
  uploadDate: EXPLAINER.uploadDate,
  duration: isoDuration(EXPLAINER.seconds),
  contentUrl: `${SITE_URL}${EXPLAINER.src}`,
  inLanguage: 'en-IN',
  publisher: { '@id': `${SITE_URL}/#organization` },
});

function home(): PageMeta {
  const { min, max } = ages();
  return {
    path: '/',
    title: `${PRODUCT_NAME} — A Safe Computer for Kids on Your Smart TV`,
    description:
      `Turn your smart TV into a safe first computer for children aged ${min}–${max}. ` +
      'Learning games played with the TV remote, screen-time limits, no ads, no chat. Try it free.',
    index: true,
    priority: 1,
    changefreq: 'weekly',
    video: true,
    jsonLd: [
      organization(),
      {
        '@context': 'https://schema.org',
        '@type': 'WebSite',
        '@id': `${SITE_URL}/#website`,
        name: PRODUCT_NAME,
        url: SITE_URL,
        inLanguage: 'en-IN',
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
      {
        '@context': 'https://schema.org',
        '@type': 'WebApplication',
        name: PRODUCT_NAME,
        url: SITE_URL,
        applicationCategory: 'EducationalApplication',
        operatingSystem: 'Any web browser, including smart TVs (Fire TV, Samsung, LG)',
        description:
          'A safe, time-limited computer for children on the TV you already own: learning games ' +
          'played with the remote, parental time limits, no adverts and no tracking.',
        inLanguage: 'en-IN',
        audience: { '@type': 'PeopleAudience', suggestedMinAge: min, suggestedMaxAge: max },
        offers: PLANS.map((plan) => ({
          '@type': 'Offer',
          name: plan.name,
          price: plan.offerPriceInr,
          priceCurrency: 'INR',
          category: 'subscription',
        })),
        publisher: { '@id': `${SITE_URL}/#organization` },
      },
      videoObject(),
      {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: faqs().map((item) => ({
          '@type': 'Question',
          name: item.q,
          acceptedAnswer: { '@type': 'Answer', text: item.a },
        })),
      },
    ],
  };
}

function arcade(): PageMeta {
  const count = localApps(CATALOG).length;
  return {
    path: '/try',
    title: `Free Learning Games for Kids — Play on Your TV${SUFFIX}`,
    description:
      `All ${count} games and activities — typing, maths, drawing, coding and puzzles — free in ` +
      'your browser. Play with a TV remote. No sign-up, no ads, nothing uploaded.',
    index: true,
    priority: 0.9,
    changefreq: 'weekly',
    jsonLd: [breadcrumbs([['Home', '/'], ['Free games', '/try']])],
  };
}

function activity(id: string): PageMeta | null {
  const app = findApp(id);
  if (!app || app.launch.kind !== 'local') return null;
  const minAge = AGE_BAND_SPECS[app.minBand].minAge;
  return {
    path: `/try/${app.id}`,
    title: `${app.name} for Kids — Free, Plays with a TV Remote${SUFFIX}`,
    description:
      `${app.tagline} Free for ages ${minAge}+ in your browser — on a smart TV with the remote, ` +
      'or on a phone, tablet or laptop. No sign-up, no ads.',
    index: true,
    priority: 0.7,
    changefreq: 'monthly',
    jsonLd: [
      breadcrumbs([
        ['Home', '/'],
        ['Free games', '/try'],
        [app.name, `/try/${app.id}`],
      ]),
    ],
  };
}

const STATIC: Record<string, Omit<PageMeta, 'path'>> = {
  '/about': {
    title: `About Us — Why We Built ${PRODUCT_NAME}`,
    description:
      `${PRODUCT_NAME} is built in India by ${FOUNDERS.map((f) => `${f.name} (${f.role})`).join(' and ')}: ` +
      'a safe, time-limited computer for children on the TV you already own.',
    index: true,
    priority: 0.6,
    changefreq: 'monthly',
    jsonLd: [organization(), breadcrumbs([['Home', '/'], ['About us', '/about']])],
  },
  '/contact': {
    title: `Contact Us${SUFFIX}`,
    description: `Questions, problems or ideas — write to the people who build ${PRODUCT_NAME}. A person replies.`,
    index: true,
    priority: 0.5,
    changefreq: 'yearly',
  },
  '/privacy': {
    title: `Privacy Policy — What We Keep, and When We Delete It${SUFFIX}`,
    description:
      'Exactly what we store about a family, why, and on what schedule it is deleted. No adverts, ' +
      'no tracking, nothing your child makes is ever uploaded.',
    index: true,
    priority: 0.5,
    changefreq: 'monthly',
  },
  '/terms': {
    title: `Terms of Service${SUFFIX}`,
    description: `The terms for using ${PRODUCT_NAME}: accounts, children's profiles, plans and billing.`,
    index: true,
    priority: 0.3,
    changefreq: 'yearly',
  },
  '/refunds': {
    title: `Cancellations & Refunds${SUFFIX}`,
    description: 'Cancel any time, from the parent dashboard. How refunds work, and how long they take.',
    index: true,
    priority: 0.3,
    changefreq: 'yearly',
  },
  '/delivery': {
    title: `How the Service Is Delivered${SUFFIX}`,
    description: `${PRODUCT_NAME} is delivered online, to the browser on your TV, laptop, tablet or phone. Nothing is posted.`,
    index: true,
    priority: 0.3,
    changefreq: 'yearly',
  },
};

/** The signed-in and in-between screens: named, but never indexed. */
const PRIVATE_TITLES: Record<string, string> = {
  '/signin': 'Parent sign in',
  '/forgot': 'Forgotten password',
  '/reset': 'Choose a new password',
  '/verify': 'Confirm and sign in',
  '/household': 'Who is playing?',
  '/parent': 'Parent dashboard',
  '/kid': 'Home',
};

export function metaFor(pathname: string): PageMeta {
  const path = pathname.length > 1 ? pathname.replace(/\/+$/, '') : pathname;
  if (path === '/') return home();
  if (path === '/try') return arcade();
  const tryMatch = /^\/try\/([^/]+)$/.exec(path);
  if (tryMatch) {
    const meta = activity(tryMatch[1]!);
    if (meta) return meta;
  }
  const known = STATIC[path];
  if (known) return { path, ...known };
  return {
    path,
    title: PRIVATE_TITLES[path] ? `${PRIVATE_TITLES[path]}${SUFFIX}` : PRODUCT_NAME,
    description: home().description,
    index: false,
  };
}

/** Every address that should be in search results, for the build. */
export function publicPages(): PageMeta[] {
  return [
    home(),
    arcade(),
    ...localApps(CATALOG)
      .map((app) => activity(app.id))
      .filter((meta): meta is PageMeta => meta !== null),
    ...Object.entries(STATIC).map(([path, meta]) => ({ path, ...meta })),
  ];
}

const escapeHtml = (s: string) =>
  s.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/**
 * The <head> tags for one page, as HTML. Used by the build; the browser keeps
 * the same tags current with RouteMeta.
 */
export function headTags(meta: PageMeta): string {
  const url = `${SITE_URL}${meta.path === '/' ? '/' : meta.path}`;
  const tags = [
    `<title>${escapeHtml(meta.title)}</title>`,
    `<meta name="description" content="${escapeHtml(meta.description)}" />`,
    `<meta name="robots" content="${meta.index ? 'index, follow, max-image-preview:large' : 'noindex, nofollow'}" />`,
  ];
  if (meta.index) {
    tags.push(
      `<link rel="canonical" href="${url}" />`,
      `<meta property="og:type" content="website" />`,
      `<meta property="og:site_name" content="${escapeHtml(PRODUCT_NAME)}" />`,
      `<meta property="og:locale" content="en_IN" />`,
      `<meta property="og:title" content="${escapeHtml(meta.title)}" />`,
      `<meta property="og:description" content="${escapeHtml(meta.description)}" />`,
      `<meta property="og:url" content="${url}" />`,
      `<meta property="og:image" content="${SITE_URL}${OG_IMAGE}" />`,
      `<meta property="og:image:width" content="1200" />`,
      `<meta property="og:image:height" content="630" />`,
      `<meta property="og:image:alt" content="${escapeHtml(`${PRODUCT_NAME} on a TV`)}" />`,
      `<meta name="twitter:card" content="summary_large_image" />`,
      `<meta name="twitter:title" content="${escapeHtml(meta.title)}" />`,
      `<meta name="twitter:description" content="${escapeHtml(meta.description)}" />`,
      `<meta name="twitter:image" content="${SITE_URL}${OG_IMAGE}" />`,
    );
    if (meta.video) {
      tags.push(
        `<meta property="og:video" content="${SITE_URL}${EXPLAINER.src}" />`,
        `<meta property="og:video:type" content="video/mp4" />`,
      );
    }
  }
  for (const data of meta.jsonLd ?? []) {
    // `<` escaped so a string in the data can never close the script tag.
    tags.push(
      `<script type="application/ld+json">${JSON.stringify(data).replace(/</g, '\\u003c')}</script>`,
    );
  }
  return tags.join('\n    ');
}

function setTag(selector: string, create: () => HTMLElement, attr: string, value: string | null) {
  let el = document.head.querySelector<HTMLElement>(selector);
  if (value === null) {
    el?.remove();
    return;
  }
  if (!el) {
    el = create();
    document.head.appendChild(el);
  }
  el.setAttribute(attr, value);
}

const metaEl = (key: 'name' | 'property', name: string) => () => {
  const el = document.createElement('meta');
  el.setAttribute(key, name);
  return el;
};

/**
 * Keeps the title and the tags that matter in step with the route.
 *
 * Structured data is not rewritten here -- search engines read it from the
 * HTML the build wrote, and a script tag swapped in after load helps nobody.
 */
export function RouteMeta() {
  const { pathname } = useLocation();
  useEffect(() => {
    const meta = metaFor(pathname);
    const url = `${SITE_URL}${meta.path}`;
    document.title = meta.title;
    setTag('meta[name="description"]', metaEl('name', 'description'), 'content', meta.description);
    setTag(
      'meta[name="robots"]',
      metaEl('name', 'robots'),
      'content',
      meta.index ? 'index, follow, max-image-preview:large' : 'noindex, nofollow',
    );
    setTag(
      'link[rel="canonical"]',
      () => {
        const el = document.createElement('link');
        el.setAttribute('rel', 'canonical');
        return el;
      },
      'href',
      meta.index ? url : null,
    );
    setTag('meta[property="og:title"]', metaEl('property', 'og:title'), 'content', meta.title);
    setTag('meta[property="og:url"]', metaEl('property', 'og:url'), 'content', url);
  }, [pathname]);
  return null;
}
