import { createHash, randomUUID } from 'crypto';

interface AuditEntry {
  id: string;
  sequenceNumber: number;
  hash: string;
  previousHash: string;
  timestamp: string;
  clientId: string;
  clientType: string;
  messageType: string;
  direction: 'inbound' | 'outbound';
  sessionId: string;
  agentId: string;
}

interface AuditFilters {
  from?: string;
  to?: string;
  type?: string;
  clientId?: string;
}

export class AuditMiddleware {
  private entries: AuditEntry[] = [];
  private lastHash: string = '0000000000000000';
  private sequenceNumber: number = 0;

  logMessage(
    clientId: string,
    clientType: string,
    message: { type: string; sessionId?: string; payload?: any },
    direction: 'inbound' | 'outbound'
  ): void {
    const seq = this.sequenceNumber++;
    const timestamp = new Date().toISOString();
    const agentId = message.payload?.agentId ?? message.payload?.from ?? '';

    const hashInput = JSON.stringify({
      sequenceNumber: seq,
      timestamp,
      clientId,
      messageType: message.type,
      direction,
      previousHash: this.lastHash,
    });

    const hash = createHash('sha256').update(hashInput).digest('hex');

    const entry: AuditEntry = {
      id: randomUUID(),
      sequenceNumber: seq,
      hash,
      previousHash: this.lastHash,
      timestamp,
      clientId,
      clientType,
      messageType: message.type,
      direction,
      sessionId: message.sessionId ?? '',
      agentId: typeof agentId === 'string' ? agentId : '',
    };

    this.entries.push(entry);
    this.lastHash = hash;

    // Persist to DB with retry
    const persistEntry = async (retries = 2) => {
      try {
        const { query } = await import('./db.js');
        await query(
          `INSERT INTO audit_log (id, sequence_number, hash, previous_hash, client_id, client_type, message_type, direction, session_id, agent_id, timestamp)
           VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)`,
          [entry.id, entry.sequenceNumber, entry.hash, entry.previousHash, entry.clientId, entry.clientType, entry.messageType, entry.direction, entry.sessionId, entry.agentId, entry.timestamp]
        );
      } catch (err: any) {
        if (retries > 0) {
          setTimeout(() => persistEntry(retries - 1), 1000);
        } else {
          console.error('[AuditMiddleware] Failed to persist audit entry after retries:', err?.message);
        }
      }
    };
    persistEntry();
  }

  getEntries(filters?: AuditFilters): AuditEntry[] {
    let results = this.entries;

    if (filters?.from) {
      const fromTime = new Date(filters.from).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() >= fromTime);
    }
    if (filters?.to) {
      const toTime = new Date(filters.to).getTime();
      results = results.filter(e => new Date(e.timestamp).getTime() <= toTime);
    }
    if (filters?.type) {
      results = results.filter(e => e.messageType === filters.type);
    }
    if (filters?.clientId) {
      results = results.filter(e => e.clientId === filters.clientId);
    }

    return results;
  }

  verifyIntegrity(): { valid: boolean; brokenAt?: number; totalEntries: number } {
    let previousHash = '0000000000000000';

    for (const entry of this.entries) {
      if (entry.previousHash !== previousHash) {
        return { valid: false, brokenAt: entry.sequenceNumber, totalEntries: this.entries.length };
      }

      const hashInput = JSON.stringify({
        sequenceNumber: entry.sequenceNumber,
        timestamp: entry.timestamp,
        clientId: entry.clientId,
        messageType: entry.messageType,
        direction: entry.direction,
        previousHash: entry.previousHash,
      });

      const expectedHash = createHash('sha256').update(hashInput).digest('hex');
      if (entry.hash !== expectedHash) {
        return { valid: false, brokenAt: entry.sequenceNumber, totalEntries: this.entries.length };
      }

      previousHash = entry.hash;
    }

    return { valid: true, totalEntries: this.entries.length };
  }
}
