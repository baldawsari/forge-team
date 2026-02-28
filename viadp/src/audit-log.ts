/**
 * Immutable Audit Log for the VIADP protocol.
 *
 * Provides append-only logging with hash chain integrity,
 * filtering, export capabilities, and tamper detection.
 */

import { v4 as uuidv4 } from 'uuid';
import { z } from 'zod';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type AuditAction =
  | 'delegation.requested'
  | 'delegation.accepted'
  | 'delegation.rejected'
  | 'delegation.completed'
  | 'delegation.failed'
  | 'delegation.revoked'
  | 'delegation.redelegated'
  | 'trust.updated'
  | 'trust.decayed'
  | 'trust.reset'
  | 'verification.created'
  | 'verification.proof_submitted'
  | 'verification.verified'
  | 'verification.rejected'
  | 'circuit_breaker.opened'
  | 'circuit_breaker.closed'
  | 'circuit_breaker.half_open'
  | 'health_check.passed'
  | 'health_check.failed'
  | 'consensus.reached'
  | 'parallel_bid.completed';

export interface AuditEntry {
  id: string;
  timestamp: Date;
  type: AuditAction;
  delegationId: string;
  from: string;
  to: string;
  action: string;
  data: Record<string, unknown>;
  hash: string;
  previousHash: string;
  sequenceNumber: number;
}

export interface AuditFilter {
  delegationId?: string;
  agentId?: string;
  type?: AuditAction | AuditAction[];
  dateRange?: {
    from: Date;
    to: Date;
  };
  limit?: number;
  offset?: number;
}

export interface IntegrityReport {
  valid: boolean;
  totalEntries: number;
  checkedEntries: number;
  firstBrokenAt: number | null;
  brokenEntries: number[];
  computeTimeMs: number;
}

// ---------------------------------------------------------------------------
// Validation
// ---------------------------------------------------------------------------

export const AuditEntryInputSchema = z.object({
  type: z.string(),
  delegationId: z.string(),
  from: z.string(),
  to: z.string(),
  action: z.string(),
  data: z.record(z.unknown()),
});

// ---------------------------------------------------------------------------
// Audit Log
// ---------------------------------------------------------------------------

export class AuditLog {
  private entries: AuditEntry[] = [];
  private lastHash = 'genesis_000000000000';
  private sequenceCounter = 0;
  private readonly hashSeed: string;

  constructor(hashSeed: string = 'forgeteam-viadp-audit') {
    this.hashSeed = hashSeed;
  }

  /**
   * Append a new entry to the immutable log.
   * Computes a hash linking to the previous entry for tamper detection.
   */
  log(entry: {
    type: AuditAction;
    delegationId: string;
    from: string;
    to: string;
    action: string;
    data: Record<string, unknown>;
  }): AuditEntry {
    const id = uuidv4();
    const timestamp = new Date();
    const previousHash = this.lastHash;
    const sequenceNumber = this.sequenceCounter++;

    const auditEntry: AuditEntry = {
      id,
      timestamp,
      type: entry.type,
      delegationId: entry.delegationId,
      from: entry.from,
      to: entry.to,
      action: entry.action,
      data: entry.data,
      hash: '', // Computed below
      previousHash,
      sequenceNumber,
    };

    // Compute hash of this entry including the previous hash
    auditEntry.hash = this.computeEntryHash(auditEntry);
    this.lastHash = auditEntry.hash;

    // Append (immutable - no modification after this point)
    this.entries.push(Object.freeze(auditEntry) as AuditEntry);

    return auditEntry;
  }

  /**
   * Query the log with filters.
   */
  getLog(filters: AuditFilter = {}): AuditEntry[] {
    let results = this.entries;

    if (filters.delegationId) {
      results = results.filter(
        (e) => e.delegationId === filters.delegationId,
      );
    }

    if (filters.agentId) {
      results = results.filter(
        (e) => e.from === filters.agentId || e.to === filters.agentId,
      );
    }

    if (filters.type) {
      const types = Array.isArray(filters.type)
        ? filters.type
        : [filters.type];
      const typeSet = new Set(types);
      results = results.filter((e) => typeSet.has(e.type));
    }

    if (filters.dateRange) {
      const { from, to } = filters.dateRange;
      results = results.filter(
        (e) => e.timestamp >= from && e.timestamp <= to,
      );
    }

    // Apply offset and limit
    const offset = filters.offset ?? 0;
    const limit = filters.limit ?? results.length;
    results = results.slice(offset, offset + limit);

    return results;
  }

  /**
   * Get the total number of entries.
   */
  getEntryCount(): number {
    return this.entries.length;
  }

  /**
   * Get entries by sequence number range.
   */
  getBySequenceRange(from: number, to: number): AuditEntry[] {
    return this.entries.filter(
      (e) => e.sequenceNumber >= from && e.sequenceNumber <= to,
    );
  }

  /**
   * Get the most recent N entries.
   */
  getRecent(count: number = 20): AuditEntry[] {
    return this.entries.slice(-count);
  }

  /**
   * Verify the integrity of the hash chain.
   * Recomputes every hash and checks for consistency.
   */
  verifyIntegrity(): IntegrityReport {
    const startTime = Date.now();
    const brokenEntries: number[] = [];

    if (this.entries.length === 0) {
      return {
        valid: true,
        totalEntries: 0,
        checkedEntries: 0,
        firstBrokenAt: null,
        brokenEntries: [],
        computeTimeMs: Date.now() - startTime,
      };
    }

    let previousHash = 'genesis_000000000000';

    for (let i = 0; i < this.entries.length; i++) {
      const entry = this.entries[i];

      // Verify previous hash reference
      if (entry.previousHash !== previousHash) {
        brokenEntries.push(i);
        // Continue checking to find all broken entries
      }

      // Verify the entry's own hash
      const expectedHash = this.computeEntryHash({
        ...entry,
        hash: '', // Hash field is not included in the hash computation
      });

      if (entry.hash !== expectedHash) {
        if (!brokenEntries.includes(i)) {
          brokenEntries.push(i);
        }
      }

      // Verify sequence number
      if (entry.sequenceNumber !== i) {
        if (!brokenEntries.includes(i)) {
          brokenEntries.push(i);
        }
      }

      previousHash = entry.hash;
    }

    return {
      valid: brokenEntries.length === 0,
      totalEntries: this.entries.length,
      checkedEntries: this.entries.length,
      firstBrokenAt: brokenEntries.length > 0 ? brokenEntries[0] : null,
      brokenEntries,
      computeTimeMs: Date.now() - startTime,
    };
  }

  /**
   * Export the log in the specified format.
   */
  exportLog(
    format: 'json' | 'csv',
    filters?: AuditFilter,
  ): string {
    const entries = filters ? this.getLog(filters) : this.entries;

    switch (format) {
      case 'json':
        return this.exportAsJson(entries);
      case 'csv':
        return this.exportAsCsv(entries);
      default:
        throw new Error(`Unsupported export format: ${format}`);
    }
  }

  /**
   * Get statistics about the audit log.
   */
  getStatistics(): {
    totalEntries: number;
    entriesByType: Record<string, number>;
    entriesByAgent: Record<string, number>;
    dateRange: { first: Date | null; last: Date | null };
    integrityValid: boolean;
  } {
    const entriesByType: Record<string, number> = {};
    const entriesByAgent: Record<string, number> = {};

    for (const entry of this.entries) {
      entriesByType[entry.type] = (entriesByType[entry.type] ?? 0) + 1;

      if (entry.from) {
        entriesByAgent[entry.from] =
          (entriesByAgent[entry.from] ?? 0) + 1;
      }
      if (entry.to && entry.to !== entry.from) {
        entriesByAgent[entry.to] = (entriesByAgent[entry.to] ?? 0) + 1;
      }
    }

    const integrity = this.verifyIntegrity();

    return {
      totalEntries: this.entries.length,
      entriesByType,
      entriesByAgent,
      dateRange: {
        first: this.entries.length > 0 ? this.entries[0].timestamp : null,
        last:
          this.entries.length > 0
            ? this.entries[this.entries.length - 1].timestamp
            : null,
      },
      integrityValid: integrity.valid,
    };
  }

  toJSON(): string {
    return JSON.stringify({
      entries: this.entries.map(e => ({
        ...e,
        timestamp: e.timestamp instanceof Date ? e.timestamp.toISOString() : e.timestamp,
      })),
      lastHash: this.lastHash,
      sequenceCounter: this.sequenceCounter,
    });
  }

  static fromDB(rows: { id: string; timestamp: string; type: string; delegation_id: string; from_agent: string; to_agent: string; action: string; data: Record<string, unknown>; hash: string; previous_hash: string; sequence_number: number }[]): AuditLog {
    const log = new AuditLog();
    for (const row of rows) {
      const entry: AuditEntry = {
        id: row.id,
        timestamp: new Date(row.timestamp),
        type: row.type as AuditAction,
        delegationId: row.delegation_id,
        from: row.from_agent,
        to: row.to_agent,
        action: row.action,
        data: row.data,
        hash: row.hash,
        previousHash: row.previous_hash,
        sequenceNumber: row.sequence_number,
      };
      log.entries.push(Object.freeze(entry) as AuditEntry);
      log.lastHash = entry.hash;
      log.sequenceCounter = entry.sequenceNumber + 1;
    }
    return log;
  }

  /**
   * Import entries from a previously exported JSON log.
   * Verifies integrity of imported entries before accepting them.
   */
  importLog(jsonData: string): {
    imported: number;
    rejected: number;
    errors: string[];
  } {
    const errors: string[] = [];
    let imported = 0;
    let rejected = 0;

    let parsedEntries: AuditEntry[];
    try {
      const parsed = JSON.parse(jsonData);
      parsedEntries = (parsed.entries ?? parsed) as AuditEntry[];
    } catch {
      return { imported: 0, rejected: 0, errors: ['Invalid JSON'] };
    }

    for (const entry of parsedEntries) {
      try {
        // Validate structure
        if (!entry.id || !entry.type || !entry.hash) {
          errors.push(`Entry missing required fields: ${entry.id ?? 'unknown'}`);
          rejected++;
          continue;
        }

        // Verify hash chain if we have existing entries
        if (this.entries.length > 0) {
          const expectedPrevHash = this.lastHash;
          if (entry.previousHash !== expectedPrevHash) {
            errors.push(
              `Hash chain break at entry ${entry.id}: expected prevHash ${expectedPrevHash}, got ${entry.previousHash}`,
            );
            rejected++;
            continue;
          }
        }

        // Reconstruct dates
        const reconstructed: AuditEntry = {
          ...entry,
          timestamp: new Date(entry.timestamp),
          sequenceNumber: this.sequenceCounter++,
        };

        this.entries.push(Object.freeze(reconstructed) as AuditEntry);
        this.lastHash = reconstructed.hash;
        imported++;
      } catch (err) {
        errors.push(
          `Failed to import entry ${entry.id}: ${err instanceof Error ? err.message : String(err)}`,
        );
        rejected++;
      }
    }

    return { imported, rejected, errors };
  }

  // ---------------------------------------------------------------------------
  // Private helpers
  // ---------------------------------------------------------------------------

  private computeEntryHash(entry: AuditEntry | (Omit<AuditEntry, 'hash'> & { hash: string })): string {
    const payload = [
      this.hashSeed,
      entry.id,
      entry.timestamp instanceof Date
        ? entry.timestamp.toISOString()
        : String(entry.timestamp),
      entry.type,
      entry.delegationId,
      entry.from,
      entry.to,
      entry.action,
      JSON.stringify(entry.data),
      entry.previousHash,
      String(entry.sequenceNumber),
    ].join('|');

    // FNV-1a inspired hash for deterministic, fast hashing
    let hash = 0x811c9dc5;
    for (let i = 0; i < payload.length; i++) {
      hash ^= payload.charCodeAt(i);
      hash = (hash * 0x01000193) | 0;
    }

    // Convert to hex string with prefix
    const hex = (hash >>> 0).toString(16).padStart(8, '0');
    return `audit_${hex}_${entry.sequenceNumber.toString(36).padStart(6, '0')}`;
  }

  private exportAsJson(entries: AuditEntry[]): string {
    const output = {
      exportedAt: new Date().toISOString(),
      entryCount: entries.length,
      hashSeed: this.hashSeed,
      entries: entries.map((e) => ({
        ...e,
        timestamp: e.timestamp.toISOString(),
      })),
    };
    return JSON.stringify(output, null, 2);
  }

  private exportAsCsv(entries: AuditEntry[]): string {
    const headers = [
      'id',
      'timestamp',
      'type',
      'delegationId',
      'from',
      'to',
      'action',
      'data',
      'hash',
      'previousHash',
      'sequenceNumber',
    ];

    const rows = entries.map((e) =>
      [
        this.csvEscape(e.id),
        this.csvEscape(e.timestamp.toISOString()),
        this.csvEscape(e.type),
        this.csvEscape(e.delegationId),
        this.csvEscape(e.from),
        this.csvEscape(e.to),
        this.csvEscape(e.action),
        this.csvEscape(JSON.stringify(e.data)),
        this.csvEscape(e.hash),
        this.csvEscape(e.previousHash),
        String(e.sequenceNumber),
      ].join(','),
    );

    return [headers.join(','), ...rows].join('\n');
  }

  private csvEscape(value: string): string {
    if (
      value.includes(',') ||
      value.includes('"') ||
      value.includes('\n')
    ) {
      return `"${value.replace(/"/g, '""')}"`;
    }
    return value;
  }
}
