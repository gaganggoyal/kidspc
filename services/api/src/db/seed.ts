/**
 * Development seed.
 *
 * Creates one household with a child in each band, consent already granted, so
 * there is something to click within seconds of a clone. Idempotent: running it
 * twice leaves one family, not two.
 *
 *   pnpm --filter @kidpc/api seed
 */
import { ageBandForBirth } from '@kidpc/shared';
import { loadConfig } from '../config.js';
import { createDatabase, migrate } from '../db/client.js';
import { createRepos } from '../repos.js';
import { hashSecret } from '../auth/password.js';
import { digestProof } from '../consent/verifier.js';

const EMAIL = 'demo@kidpc.test';
const PASSWORD = 'demo-password-1234';

const FAMILY = [
  { displayName: 'Meera', birthYear: 2019, birthMonth: 4, avatarId: 'panda', pin: '1111' },
  { displayName: 'Ravi', birthYear: 2015, birthMonth: 9, avatarId: 'rocket', pin: '2222' },
  { displayName: 'Anaya', birthYear: 2011, birthMonth: 2, avatarId: 'dragon', pin: '3333' },
];

const config = loadConfig();
const database = await createDatabase(config);
await migrate(database, (msg) => console.log(`[db] ${msg}`));
const repos = createRepos(database.db);

const existing = await repos.guardians.byEmail(EMAIL);
if (existing) {
  console.log(`Seed household already exists (${EMAIL}); removing it first.`);
  await repos.guardians.purge(existing.id);
}

const guardian = await repos.guardians.create({
  email: EMAIL,
  passwordHash: await hashSecret(PASSWORD),
  displayName: 'Demo Parent',
  timezone: 'Asia/Kolkata',
});

for (const spec of FAMILY) {
  const band = ageBandForBirth(spec, new Date());
  if (!band) throw new Error(`${spec.displayName} is below the supported age`);

  const child = await repos.children.create({
    guardianId: guardian.id,
    displayName: spec.displayName,
    birthYear: spec.birthYear,
    birthMonth: spec.birthMonth,
    avatarId: spec.avatarId,
    pinHash: await hashSecret(spec.pin),
    band,
  });

  // Consent is granted directly here rather than through the mock verifier,
  // because the point of the seed is to skip onboarding -- but it is recorded
  // as `dev_mock` so nobody can mistake it for a real verification.
  await repos.consents.grant({
    guardianId: guardian.id,
    childId: child.id,
    method: 'dev_mock',
    scopes: ['account', 'progress'],
    proofDigest: digestProof(config, `seed:${child.id}`),
    expiresInDays: 365,
  });

  console.log(`  ${spec.displayName.padEnd(6)} ${band.padEnd(9)} PIN ${spec.pin}  ${child.id}`);
}

console.log(`\nSigned in as ${EMAIL} / ${PASSWORD}`);
await database.close();
