import { createHash } from 'node:crypto';
import type { AllowedCommand } from './commands/allowed.js';

/** The exact text the user confirms: one command per line, LF, no trailing newline. */
export const renderPreview = (commands: readonly AllowedCommand[]): string => commands.map((c) => c.text).join('\n');

/** Bound into the confirmation; the worker re-renders and must get the same hash (SPEC §8.5). */
export const previewSha256 = (preview: string): string => createHash('sha256').update(preview, 'utf8').digest('hex');
