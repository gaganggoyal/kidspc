import { durationLabel, EXPLAINER } from '../explainer';

/**
 * "See it on your TV": the video, and the three steps it shows.
 *
 * `preload="none"`: nothing is downloaded until a parent presses play, which
 * matters on a phone on mobile data and is the only honest default on a site
 * that promises not to fetch things on anyone's behalf. The steps sit beside
 * it, so the section says everything with the sound off and the video unplayed.
 */
export function Explainer() {
  return (
    <section className="home-section tour" id="tour" aria-labelledby="tour-title">
      <div className="tour-grid">
        <div className="tour-video">
          <video
            controls
            preload="none"
            playsInline
            poster={EXPLAINER.poster}
            aria-label={EXPLAINER.title}
          >
            <source src={EXPLAINER.src} type="video/mp4" />
            <track kind="captions" src={EXPLAINER.captions} srcLang="en" label="English" />
          </video>
        </div>
        <div className="tour-copy">
          <span className="cert-label">See it on your TV · {durationLabel(EXPLAINER.seconds)}</span>
          <h2 id="tour-title">From the sofa, in three steps</h2>
          <ol className="tour-steps">
            <li>
              <strong>Open kidspc.online</strong> in your TV&apos;s browser — Fire TV, Samsung, LG,
              or a laptop plugged into the TV.
            </li>
            <li>
              <strong>Sign in with a code</strong> we email to your phone. No long password on a
              remote.
            </li>
            <li>
              <strong>Hand over the remote.</strong> Your child picks their face, types four digits,
              and plays — arrows to move, OK to choose.
            </li>
          </ol>
        </div>
      </div>
    </section>
  );
}
