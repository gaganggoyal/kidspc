/**
 * Writes the sign-in letter, as the service renders it, for the capture.
 *
 *   tsx tools/video/letter.ts 482915 out.html
 */
import { writeFileSync } from 'node:fs';
import { signInCodeEmail } from '../../services/api/src/email/templates.js';

const [code, out] = process.argv.slice(2);
const letter = signInCodeEmail({
  to: 'priya@example.com',
  displayName: 'Priya',
  code: code!,
  url: 'https://kidspc.online/verify?token=example',
  publicUrl: 'https://kidspc.online',
});
writeFileSync(out!, letter.html);
