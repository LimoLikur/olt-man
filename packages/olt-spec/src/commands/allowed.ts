import { CONTROL_CHARS } from '../params.js';

declare const brand: unique symbol;

export type CommandKind = 'read' | 'write' | 'session';

/** A question the OLT asks before it runs a command, and the answer the session sends. */
export interface CommandConfirmation {
  /** Matched against the end of the screen, e.g. "Confirm to reboot? [yes/no]:". */
  readonly question: RegExp;
  readonly answer: string;
}

/**
 * A command that may be sent to an OLT. Only builders in this package can create one: the
 * brand is a module-private symbol, so a plain object literal never type-checks as
 * AllowedCommand (SPEC §6.1, CLAUDE.md rule 6).
 */
export type AllowedCommand = {
  readonly text: string;
  readonly kind: CommandKind;
  /**
   * The CLI mode the prompt must show before the command is sent, e.g. "(gpon-onu-mng 1/1/8:4)".
   * The session refuses the command in any other mode: `reboot` restarts one ONU only inside
   * its pon-onu-mng mode, and must never reach the OLT anywhere else.
   */
  readonly inMode?: RegExp;
  /** The OLT asks this before running the command; the session answers it (SPEC §8.5, reboot). */
  readonly confirm?: CommandConfirmation;
  readonly [brand]: true;
};

export class CommandBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandBuildError';
  }
}

function checkLine(text: string): void {
  if (text.length === 0 || text.length > 512 || CONTROL_CHARS.test(text)) {
    throw new CommandBuildError('command text is empty, too long or contains control characters');
  }
}

/** Internal: the only place an AllowedCommand is minted. */
export function mint(text: string, kind: CommandKind, guards: { inMode?: RegExp; confirm?: CommandConfirmation } = {}): AllowedCommand {
  checkLine(text);
  if (guards.confirm) checkLine(guards.confirm.answer);
  return Object.freeze({
    text,
    kind,
    ...(guards.inMode ? { inMode: guards.inMode } : {}),
    ...(guards.confirm ? { confirm: Object.freeze({ ...guards.confirm }) } : {}),
  }) as AllowedCommand;
}
