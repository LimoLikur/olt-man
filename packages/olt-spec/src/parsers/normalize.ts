// Terminal clean-up applied to raw SSH output before any parser runs.

// eslint-disable-next-line no-control-regex
const ANSI = /\x1b(?:\[[0-?]*[ -/]*[@-~]|[@-Z\\-_])/g;
const MORE = /\s*--More--\s*/g;

/** Applies backspaces and carriage-return overwrites the way a terminal would. */
function renderLine(line: string): string {
  const cells: string[] = [];
  let col = 0;
  for (const ch of line) {
    if (ch === '\r') col = 0;
    else if (ch === '\b') col = Math.max(0, col - 1);
    else {
      cells[col] = ch;
      col++;
    }
  }
  return Array.from(cells, (c) => c ?? ' ').join('');
}

/**
 * Strips ANSI sequences, pager leftovers (--More-- and its erase), backspaces and other
 * control characters, and normalises line endings. Trailing whitespace is trimmed.
 */
export function normalize(raw: string): string {
  return raw
    .replace(ANSI, '')
    .replace(/\r\n/g, '\n')
    .split('\n')
    .map((line) => renderLine(line).replace(MORE, ''))
    // eslint-disable-next-line no-control-regex
    .map((line) => line.replace(/[\x00-\x08\x0b-\x1f\x7f]/g, '').trimEnd())
    .join('\n')
    .replace(/^\n+|\n+$/g, '');
}

export const lines = (text: string) => normalize(text).split('\n');

/**
 * ZTE's informational notices, e.g. `%Info 20272: Enter configuration commands, one per line.
 * End with CTRL/Z.` after every `configure terminal` (owner's C320, 2026-11-17). Not errors.
 */
const CLI_INFO = /^%Info\b/;

/**
 * First line that starts with `%` (ZTE error, e.g. `%Error`, `%Code`), or null. `%Info`
 * notices are skipped; any other `%` line still counts as an error (fail closed).
 */
export function findCliError(text: string): string | null {
  return lines(text).find((l) => l.startsWith('%') && !CLI_INFO.test(l)) ?? null;
}
