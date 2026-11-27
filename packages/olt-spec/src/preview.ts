import { createHash } from 'node:crypto';
import type { AllowedCommand } from './commands/allowed.js';

/**
 * The exact text the user confirms: one line per line sent, LF, no trailing newline. A command
 * the OLT confirms (`reboot`) is followed by the answer the session gives, so that is hashed too.
 */
export const renderPreview = (commands: readonly AllowedCommand[]): string => commands.flatMap((c) => (c.confirm ? [c.text, c.confirm.answer] : [c.text])).join('\n');

/** Bound into the confirmation; the worker re-renders and must get the same hash (SPEC §8.5). */
export const previewSha256 = (preview: string): string => createHash('sha256').update(preview, 'utf8').digest('hex');
