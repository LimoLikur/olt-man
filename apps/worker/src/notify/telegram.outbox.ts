import type { PrismaClient } from '@olt/db';

export interface TelegramOutboxOptions {
  apiBase: string;
  token: string;
  chatId: string;
  now?: () => Date;
  /** Alarms within this window are merged into one message (SPEC §8.2). */
  mergeWindowMs?: number;
  /** Telegram allows about 20 messages per minute per group. */
  maxPerMinute?: number;
  fetch?: typeof fetch;
}

export interface FlushResult {
  sent: number;
  merged: number;
  waiting: boolean;
}

/**
 * Sends the notification outbox to Telegram. Rows are claimed (pending -> sending) before the
 * HTTP call and marked sent after it. A crash in between leaves them "sending"; recover()
 * turns those into failed instead of resending, so a restart never duplicates a message.
 */
export class TelegramOutbox {
  private readonly now: () => Date;
  private readonly window: number;
  private readonly perMinute: number;
  private readonly http: typeof fetch;

  constructor(
    private readonly prisma: PrismaClient,
    private readonly options: TelegramOutboxOptions,
  ) {
    this.now = options.now ?? (() => new Date());
    this.window = options.mergeWindowMs ?? 10_000;
    this.perMinute = options.maxPerMinute ?? 20;
    this.http = options.fetch ?? fetch;
  }

  /** Call once at start-up. */
  async recover(): Promise<number> {
    const { count } = await this.prisma.notification.updateMany({
      where: { status: 'sending' },
      data: { status: 'failed', lastError: 'interrupted while sending; not resent to avoid duplicates' },
    });
    return count;
  }

  /** Sends at most one merged message per call. */
  async flush(): Promise<FlushResult> {
    const now = this.now();
    const oldest = await this.prisma.notification.findFirst({ where: { status: 'pending' }, orderBy: { createdAt: 'asc' } });
    if (!oldest) return { sent: 0, merged: 0, waiting: false };
    // Wait until the merge window of the oldest pending notification has closed.
    if (now.getTime() - oldest.createdAt.getTime() < this.window) return { sent: 0, merged: 0, waiting: true };
    const recentSent = await this.prisma.notification.groupBy({ by: ['sentAt'], where: { status: 'sent', sentAt: { gte: new Date(now.getTime() - 60_000) } } });
    if (recentSent.length >= this.perMinute) return { sent: 0, merged: 0, waiting: true };

    const batch = await this.prisma.notification.findMany({
      where: { status: 'pending', createdAt: { lte: new Date(oldest.createdAt.getTime() + this.window) } },
      orderBy: { createdAt: 'asc' },
      take: 20,
    });
    const ids = batch.map((n) => n.id);
    const claimed = await this.prisma.notification.updateMany({ where: { id: { in: ids }, status: 'pending' }, data: { status: 'sending', attempts: { increment: 1 } } });
    if (claimed.count !== ids.length) return { sent: 0, merged: 0, waiting: true }; // someone else got there first

    const text = batch.map((n) => (n.payload as { text: string }).text).join('\n\n');
    try {
      const res = await this.http(`${this.options.apiBase.replace(/\/$/, '')}/bot${this.options.token}/sendMessage`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ chat_id: this.options.chatId, text, disable_web_page_preview: true }),
      });
      if (!res.ok) throw new Error(`telegram HTTP ${res.status}`);
      // One sentAt per message: rate limiting counts messages, not rows.
      await this.prisma.notification.updateMany({ where: { id: { in: ids } }, data: { status: 'sent', sentAt: now, lastError: null } });
      return { sent: 1, merged: ids.length, waiting: false };
    } catch (error) {
      // The request may not have reached Telegram: put the rows back for a later attempt.
      // The token is part of the URL, so only the error class is stored.
      await this.prisma.notification.updateMany({ where: { id: { in: ids } }, data: { status: 'pending', lastError: (error as Error).name } });
      return { sent: 0, merged: 0, waiting: true };
    }
  }
}
