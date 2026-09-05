import { useEffect, useMemo, useRef, useState } from 'react';
import { ActivityShell, type ActivityApi } from './ActivityShell';

/**
 * Code Playground.
 *
 * HTML, CSS and JavaScript with a live preview. The preview runs in a sandboxed
 * iframe WITHOUT `allow-same-origin`, which means the child's code executes in
 * an opaque origin: it cannot read our cookies, our local storage, or the
 * session token. That single missing flag is the difference between a coding
 * tool and a cross-site scripting hole aimed at its own users.
 *
 * Their code stays in this browser and is never uploaded.
 */
const STORAGE_KEY = 'kidpc.code.v1';

const STARTER = {
  html: `<h1>Hello!</h1>\n<p id="out">Press the button.</p>\n<button onclick="greet()">Say hi</button>`,
  css: `body { font-family: system-ui; padding: 24px; color: #1d1b19; }\nh1 { color: #2f6f4f; }\nbutton { font-size: 1rem; padding: 8px 16px; border-radius: 8px; }`,
  js: `function greet() {\n  document.getElementById('out').textContent = 'Hi from your code!';\n}`,
};

type Pane = 'html' | 'css' | 'js';

function Playground({ activity }: { activity: ActivityApi }) {
  const [pane, setPane] = useState<Pane>('html');
  const [source, setSource] = useState(STARTER);
  const [preview, setPreview] = useState(STARTER);
  const runs = useRef(0);

  useEffect(() => {
    try {
      const stored = localStorage.getItem(STORAGE_KEY);
      if (stored) {
        const parsed = JSON.parse(stored) as typeof STARTER;
        setSource(parsed);
        setPreview(parsed);
      }
    } catch {
      // Corrupt or unavailable storage: fall back to the starter project.
    }
  }, []);

  const document_ = useMemo(() => {
    // Never write the closing script sequence literally. If this bundle is ever
    // inlined into an HTML page, that sequence would terminate the surrounding
    // script tag and break the whole app.
    const closeScript = '<\u002fscript>';
    return (
      `<!doctype html><html><head><meta charset="utf-8">` +
      `<style>${preview.css}</style></head><body>${preview.html}` +
      // Errors surface in the preview itself rather than vanishing into a
      // console a child cannot open on a TV.
      `<script>window.onerror=function(m){document.body.insertAdjacentHTML('beforeend',` +
      `'<pre style="color:#a33327;white-space:pre-wrap">'+m+'</pre>')}${closeScript}` +
      `<script>${preview.js}${closeScript}</body></html>`
    );
  }, [preview]);

  const run = () => {
    setPreview(source);
    runs.current += 1;
    activity.report('score', runs.current);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(source));
    } catch {
      // Not worth interrupting for.
    }
  };

  return (
    <div className="code-layout">
      <div className="stack" style={{ minHeight: 0 }}>
        <div className="spread">
          <div className="chips">
            {(['html', 'css', 'js'] as Pane[]).map((id) => (
              <button key={id} className="chip" aria-pressed={pane === id} onClick={() => setPane(id)}>
                {id.toUpperCase()}
              </button>
            ))}
          </div>
          <button className="primary" onClick={run}>
            ▶ Run
          </button>
        </div>
        <textarea
          className="code-editor"
          value={source[pane]}
          onChange={(e) => setSource({ ...source, [pane]: e.target.value })}
          spellCheck={false}
          autoCapitalize="off"
          autoCorrect="off"
          aria-label={`${pane} source`}
        />
        <p className="small muted" style={{ margin: 0 }}>
          Your code is kept on this device only.
        </p>
      </div>

      <iframe
        className="code-preview"
        title="Preview"
        // No allow-same-origin: the preview gets an opaque origin and cannot
        // reach anything of ours. Do not add it.
        sandbox="allow-scripts allow-modals"
        srcDoc={document_}
      />
    </div>
  );
}

export function Code() {
  return (
    <ActivityShell appId="code" title="Code Playground">
      {(activity) => <Playground activity={activity} />}
    </ActivityShell>
  );
}
