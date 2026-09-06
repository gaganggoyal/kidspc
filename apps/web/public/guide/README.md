# Walkthrough videos

Empty on purpose. The **How it works** section on the home page renders its
written steps whether or not these files exist, so the page is complete without
them and improves when they arrive.

To add one:

1. Export MP4 (H.264 + AAC), 1280x720, under ~20 MB.
2. Write captions as a WebVTT `.vtt` file beside it. Not optional -- a parent
   watching on a phone with the sound off is the ordinary case, and it is the
   only version that works for a deaf parent.
3. Optionally a `.jpg` poster frame.
4. Name them after the step id in `packages/shared/src/guides.ts`
   (`register`, `child`, `limits`, `tv`, `fix`) and add the filenames there.

Served from our own origin rather than embedded: the site's Content-Security-
Policy admits no third-party frames, an embed would carry tracking onto a page
that promises none, and a service for children should not put a recommendation
feed one click from a parent's setup screen.

Shot list and lengths: docs/setup.md, step 3.
