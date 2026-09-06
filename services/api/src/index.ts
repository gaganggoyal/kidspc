import { buildApp } from './app.js';
import { createRuntime, startMailSender, startReaper } from './boot.js';

const runtime = await createRuntime();
const app = await buildApp(runtime.ctx);
const stopReaper = startReaper(runtime.ctx);
const stopMail = startMailSender(runtime.ctx);

await app.listen({ port: runtime.ctx.config.PORT, host: runtime.ctx.config.HOST });
app.log.info(
  {
    driver: runtime.ctx.config.SESSION_DRIVER,
    consent: runtime.ctx.config.CONSENT_VERIFIER,
    database: runtime.ctx.config.DATABASE_URL ? 'postgres' : 'pglite',
    mail: runtime.ctx.mailer.name,
  },
  'KidPC API ready',
);

/**
 * Graceful shutdown. Live sessions are deliberately *not* torn down: a deploy
 * should not throw every child off their computer. The desktops carry their own
 * TTL, and the next instance's reaper reconciles whatever it finds.
 */
let shuttingDown = false;
for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    if (shuttingDown) return;
    shuttingDown = true;
    app.log.info(`${signal} received, draining`);
    stopReaper();
    stopMail();
    void app
      .close()
      .then(() => runtime.shutdown())
      .then(() => process.exit(0))
      .catch((error) => {
        app.log.error({ err: error }, 'Shutdown failed');
        process.exit(1);
      });
  });
}
