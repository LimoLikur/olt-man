import { CONTROL_CHARS } from '../params.js';

declare const brand: unique symbol;

export type CommandKind = 'read' | 'write' | 'session';

/**
 * A command that may be sent to an OLT. Only builders in this package can create one: the
 * brand is a module-private symbol, so a plain object literal never type-checks as
 * AllowedCommand (SPEC §6.1, CLAUDE.md rule 6).
 */
export type AllowedCommand = {
  readonly text: string;
  readonly kind: CommandKind;
  readonly [brand]: true;
};

export class CommandBuildError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'CommandBuildError';
  }
}

/** Internal: the only place an AllowedCommand is minted. */
export function mint(text: string, kind: CommandKind): AllowedCommand {
  if (text.length === 0 || text.length > 512 || CONTROL_CHARS.test(text)) {
    throw new CommandBuildError('command text is empty, too long or contains control characters');
  }
  return Object.freeze({ text, kind }) as AllowedCommand;
}
