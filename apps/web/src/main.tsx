import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import './styles.css';
import { captureReferral } from './referral';
import { startInputTracking } from './input';
import { AppRoutes } from './App';

/*
 * Read `?ref=` before React paints, so a visitor who lands on a referral link
 * and immediately navigates does not lose it. Nothing is sent -- the code is
 * kept on their own device until, and unless, they place an order.
 */
captureReferral();

/*
 * Start listening for what is driving the screen before the first paint, so a
 * mouse or keyboard paired to a television is noticed on the very first press
 * rather than after a navigation. See input.ts for why a media query cannot
 * answer this.
 */
startInputTracking();

/*
 * A fresh render, not hydration, even where the build wrote the page out as
 * HTML. That HTML is for the first paint and for search engines; it was
 * rendered on a build machine that knows nothing of this visitor -- whether
 * they are signed in, which week it is, whether a friend sent them -- and
 * hydrating would keep any attribute the two disagree on from the wrong one.
 * React replaces it in the same frame, so nobody sees the swap.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <AppRoutes />
    </BrowserRouter>
  </StrictMode>,
);
