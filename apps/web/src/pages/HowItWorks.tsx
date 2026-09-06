import { useState } from 'react';
import { GUIDE_STEPS, type GuideStep } from '@kidpc/shared';

/**
 * The walkthrough section.
 *
 * Written steps first, video second -- not the other way round. A parent
 * setting this up on a phone in a noisy room reads faster than they watch, the
 * text works with a screen reader and with the sound off, and the section is
 * finished before anyone has recorded anything. When a video does exist it sits
 * above its own steps rather than replacing them.
 *
 * The video element is deliberately plain: `preload="none"` so nothing is
 * fetched until asked for, no autoplay, and a captions track that is required
 * rather than optional in the type. Anything a parent must hear to follow is a
 * step that is missing from the list.
 */
function StepCard({ step, index }: { step: GuideStep; index: number }) {
  const [open, setOpen] = useState(false);

  return (
    <li className="guide-step">
      <div className="guide-head">
        <span className="guide-number" aria-hidden="true">
          {index + 1}
        </span>
        <div>
          <h3>{step.title}</h3>
          <p className="muted">{step.summary}</p>
        </div>
      </div>

      {step.video && (
        <div className="guide-video">
          {open ? (
            <video
              controls
              autoPlay
              preload="metadata"
              poster={step.poster ? `/guide/${step.poster}` : undefined}
              playsInline
            >
              <source src={`/guide/${step.video}`} type="video/mp4" />
              {step.captions && (
                <track kind="captions" src={`/guide/${step.captions}`} srcLang="en" label="English" default />
              )}
            </video>
          ) : (
            <button className="guide-play" onClick={() => setOpen(true)}>
              <span aria-hidden="true">▶</span> Watch ({Math.round(step.seconds / 15) * 15}s)
            </button>
          )}
        </div>
      )}

      <ol className="guide-list">
        {step.steps.map((line) => (
          <li key={line}>{line}</li>
        ))}
      </ol>
    </li>
  );
}

export function HowItWorks() {
  return (
    <section className="band" id="how">
      <div className="home-section">
        <h2>How it works</h2>
        <p className="lede">
          Setting up takes about five minutes, once, on any device. Your child never needs to do
          any of it.
        </p>
        <ol className="guide-steps">
          {GUIDE_STEPS.map((step, i) => (
            <StepCard key={step.id} step={step} index={i} />
          ))}
        </ol>
      </div>
    </section>
  );
}
