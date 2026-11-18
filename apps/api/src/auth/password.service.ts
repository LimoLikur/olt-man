import { hash, verify } from '@node-rs/argon2';
import { Injectable } from '@nestjs/common';

/** Argon2id (library default). */
@Injectable()
export class PasswordService {
  // Verified when the user does not exist, so timing does not reveal valid usernames.
  private dummy: Promise<string> | undefined;

  hash(password: string): Promise<string> {
    return hash(password);
  }

  async verify(passwordHash: string | undefined, password: string): Promise<boolean> {
    if (!passwordHash) {
      this.dummy ??= hash('dummy-password-for-timing');
      await verify(await this.dummy, password).catch(() => false);
      return false;
    }
    return verify(passwordHash, password).catch(() => false);
  }
}
