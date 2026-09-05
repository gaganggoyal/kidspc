import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter, Navigate, Route, Routes, useLocation } from 'react-router-dom';
import './styles.css';
import { getTokens, onTokenChange, tryRefresh } from './api';
import { SignIn } from './pages/SignIn';
import { Household } from './pages/Household';
import { Launcher } from './pages/Launcher';
import { Viewer } from './pages/Viewer';
import { ParentDashboard } from './pages/ParentDashboard';

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
  return <Navigate to="/" replace state={{ from: location.pathname }} />;
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
        <Route path="/" element={<SignIn />} />
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
        <Route path="*" element={<Navigate to="/" replace />} />
      </Routes>
    </BrowserRouter>
  );
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
