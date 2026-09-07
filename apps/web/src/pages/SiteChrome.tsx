import { Link } from 'react-router-dom';
import { FOUNDERS, PRODUCT_NAME } from '@kidpc/shared';
import { getTokens } from '../api';

/**
 * The header and footer every public page shares.
 *
 * Extracted the moment there were more than two of them. A marketing site with
 * the navigation copied into each page is a site where one page keeps a link
 * to something that has moved -- and on this site several of those links are
 * policy documents a payment provider checks.
 *
 * Section links are written as `#plans` on the home page and `/#plans`
 * everywhere else. A plain anchor rather than a router link, so the browser
 * does the scrolling it already knows how to do.
 */
export function SiteHeader({ home = false }: { home?: boolean }) {
  const signedIn = Boolean(getTokens().guardian);
  const at = (hash: string) => (home ? `#${hash}` : `/#${hash}`);

  return (
    <header className="home-nav">
      <Link to="/" className="wordmark">
        <img src="/icon-192.png" alt="" width={36} height={36} />
        <span>{PRODUCT_NAME}</span>
      </Link>
      <nav className="home-nav-links">
        <Link to="/try">Try it free</Link>
        <a href={at('how')}>How it works</a>
        <a href={at('plans')}>Plans</a>
        {signedIn ? (
          <Link to="/household" className="btn primary">
            Continue
          </Link>
        ) : (
          <Link to="/signin" className="btn">
            Parent sign in
          </Link>
        )}
      </nav>
    </header>
  );
}

/**
 * The footer.
 *
 * Carries the policy links because they have to be reachable from every page:
 * the Consumer Protection (E-Commerce) Rules expect a seller's terms and
 * contact details to be available, and a payment provider's merchant review
 * looks for exactly these five documents before it approves anybody.
 *
 * The founders are named. A service asking families to hand over a child's
 * name should be willing to say whose service it is.
 */
export function SiteFooter() {
  const year = new Date().getFullYear();
  return (
    <footer className="site-foot">
      <div className="site-foot-cols">
        <div>
          <strong>{PRODUCT_NAME}</strong>
          <p className="small muted">
            A safe computer for your child, on the screen you already own.
          </p>
          <p className="small muted">
            {FOUNDERS.map((f) => `${f.name}, ${f.role}`).join(' · ')}
          </p>
        </div>

        <nav aria-label="Product">
          <h2>Product</h2>
          <Link to="/try">Try it free</Link>
          <a href="/#how">How it works</a>
          <a href="/#plans">Plans</a>
          <Link to="/signin">Parent sign in</Link>
        </nav>

        <nav aria-label="Company">
          <h2>Company</h2>
          <Link to="/about">About us</Link>
          <Link to="/contact">Contact us</Link>
        </nav>

        <nav aria-label="Policies">
          <h2>Policies</h2>
          <Link to="/terms">Terms of service</Link>
          <Link to="/privacy">Privacy policy</Link>
          <Link to="/refunds">Cancellations &amp; refunds</Link>
          <Link to="/delivery">How the service is delivered</Link>
        </nav>
      </div>

      <div className="site-foot-base small muted">
        <span>
          © {year} {PRODUCT_NAME}. Built in India, for families in India.
        </span>
        <span>No adverts. No tracking. No profile of your child.</span>
      </div>
    </footer>
  );
}

/**
 * A page of prose: the About page and the four policy documents.
 *
 * One column, measured for reading rather than for filling a screen. Legal text
 * that runs the full width of a laptop is legal text nobody finishes, and these
 * are the pages where "nobody finished it" is the actual problem.
 */
export function Prose({
  title,
  lede,
  updated,
  children,
}: {
  title: string;
  lede?: string;
  updated?: string;
  children: React.ReactNode;
}) {
  return (
    <div className="home">
      <SiteHeader />
      <main className="prose">
        <h1>{title}</h1>
        {lede && <p className="lede">{lede}</p>}
        {updated && <p className="small muted prose-updated">Last updated {updated}</p>}
        {children}
      </main>
      <SiteFooter />
    </div>
  );
}
