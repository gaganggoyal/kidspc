import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import { CATALOG } from '@kidpc/shared';
import './styles.css';
import { getTokens, onTokenChange, tryRefresh } from './api';
import { captureReferral } from './referral';
import { startInputTracking } from './input';
import { Home } from './pages/Home';
import { TryIt } from './pages/TryIt';
import { About } from './pages/About';
import { Contact } from './pages/Contact';
import { Delivery, Privacy, Refunds, Terms } from './pages/Policies';
import { SignIn } from './pages/SignIn';
import { Forgot, ResetPassword } from './pages/Recover';
import { Verify } from './pages/EmailCode';
import { Household } from './pages/Household';
import { Launcher } from './pages/Launcher';
import { Viewer } from './pages/Viewer';
import { ParentDashboard } from './pages/ParentDashboard';
import { ActivityShell } from './play/ActivityShell';
import { GAMES } from './play/games';

/**
 * Local activities, at the route the catalogue declares, each inside the shell
 * that owns its session. Derived rather than listed: a catalogue entry with a
 * game behind it is a route, and nothing else has to be kept in step.
 */
const ACTIVITIES = CATALOG.flatMap((app) => {
  const Game = GAMES[app.id];
  return app.launch.kind === 'local' && Game ? [{ app, route: app.launch.route, Game }] : [];
});

function useTokens() {
  const [, bump] = useState(0);
  useEffect(() => onTokenChange(() => bump((n) => n + 1)), []);
  return getTokens();
}

/**
 * Routes that need a signed-in guardian. On a cold load there is no token in
 * memory -- only the refresh cookie -- so we attempt one silent refresh before
 * deciding the visitor is a stranger. Without this, every reload bounces a
 * signed-in parent back to the sign-in page.
 */
function RequireGuardian({ children }: { children: React.ReactNode }) {
  const tokens = useTokens();
  const location = useLocation();
  const [checking, setChecking] = useState(!tokens.guardian);

  useEffect(() => {
    if (tokens.guardian) return;
    let cancelled = false;
    void tryRefresh().finally(() => {
      if (!cancelled) setChecking(false);
    });
    return () => {
      cancelled = true;
    };
  }, [tokens.guardian]);

  if (tokens.guardian) return <>{children}</>;
  if (checking) return <div className="page"><div className="skeleton" style={{ height: 200 }} /></div>;
  return <Navigate to="/signin" replace state={{ from: location.pathname }} />;
}

function RequireChild({ children }: { children: React.ReactNode }) {
  const tokens = useTokens();
  // A child token is only ever minted on this device moments ago; there is
  // nothing to restore, so a missing one means "go back to the profile picker".
  return tokens.child ? <>{children}</> : <Navigate to="/household" replace />;
}

function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/" element={<Home />} />
        {/*
          The public preview. Deliberately outside RequireChild: it has no
          session, makes no request, and exists precisely for people who do not
          have an account yet.
        */}
        <Route path="/try" element={<TryIt />} />
        <Route path="/try/:appId" element={<TryIt />} />
        {/*
          The company and policy pages. Public, static, and reachable from the
          footer of every page -- a payment provider's merchant review looks for
          exactly this set, and a customer looking for the refund rules should
          not have to search for them.
        */}
        <Route path="/about" element={<About />} />
        <Route path="/contact" element={<Contact />} />
        <Route path="/terms" element={<Terms />} />
        <Route path="/privacy" element={<Privacy />} />
        <Route path="/refunds" element={<Refunds />} />
        <Route path="/delivery" element={<Delivery />} />
        <Route path="/signin" element={<SignIn />} />
        {/*
          Recovery. Public, because somebody who cannot sign in is by
          definition not signed in, and `/reset` is the address printed in the
          email -- so it is the one route here whose path is a promise to a
          message already sitting in somebody's inbox.
        */}
        <Route path="/forgot" element={<Forgot />} />
        <Route path="/reset" element={<ResetPassword />} />
        {/* Where the button in a sign-up or sign-in letter lands. Also a
            promise to a message already in somebody's inbox. */}
        <Route path="/verify" element={<Verify />} />
        <Route
          path="/household"
          element={
            <RequireGuardian>
              <Household />
            </RequireGuardian>
          }
        />
        <Route
          path="/parent"
          element={
            <RequireGuardian>
              <ParentDashboard />
            </RequireGuardian>
          }
        />
        <Route
          path="/kid"
          element={
            <RequireChild>
              <Launcher />
            </RequireChild>
          }
        />
        <Route
          path="/kid/session/:sessionId"
          element={
            <RequireChild>
              <Viewer />
            </RequireChild>
          }
        />
        {ACTIVITIES.map(({ app, route, Game }) => (
          <Route
            key={route}
            path={route}
            element={
              <RequireChild>
                <ActivityShell appId={app.id} title={app.name}>
                  {(activity) => <Game activity={activity} />}
                </ActivityShell>
              </RequireChild>
            }
          />
        ))}
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

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

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
