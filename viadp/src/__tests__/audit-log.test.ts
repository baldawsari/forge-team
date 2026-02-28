import { describe, it, expect, beforeEach } from 'vitest';
import { AuditLog, AuditEntry, AuditAction } from '../audit-log';

function logEntry(
  auditLog: AuditLog,
  overrides: Partial<{
    type: AuditAction;
    delegationId: string;
    from: string;
    to: string;
    action: string;
    data: Record<string, unknown>;
  }> = {},
): AuditEntry {
  return auditLog.log({
    type: 'delegation.requested',
    delegationId: 'del-1',
    from: 'pm-agent',
    to: 'backend-agent',
    action: 'delegate-task',
    data: { taskId: 'task-1' },
    ...overrides,
  });
}

describe('AuditLog', () => {
  let log: AuditLog;

  beforeEach(() => {
    log = new AuditLog('test-seed');
  });

  describe('append', () => {
    it('should add an entry with auto-incrementing sequence number', () => {
      const e1 = logEntry(log);
      const e2 = logEntry(log, { delegationId: 'del-2' });
      const e3 = logEntry(log, { delegationId: 'del-3' });

      expect(e1.sequenceNumber).toBe(0);
      expect(e2.sequenceNumber).toBe(1);
      expect(e3.sequenceNumber).toBe(2);
    });

    it('should compute hash for each entry', () => {
      const entry = logEntry(log);

      expect(entry.hash).toBeDefined();
      expect(typeof entry.hash).toBe('string');
      expect(entry.hash).toMatch(/^audit_[0-9a-f]{8}_/);
    });

    it('should chain hashes (each entry references previous hash)', () => {
      const e1 = logEntry(log);
      const e2 = logEntry(log, { delegationId: 'del-2' });
      const e3 = logEntry(log, { delegationId: 'del-3' });

      expect(e1.previousHash).toBe('genesis_000000000000');
      expect(e2.previousHash).toBe(e1.hash);
      expect(e3.previousHash).toBe(e2.hash);
    });

    it('should freeze entries (immutable)', () => {
      const entry = logEntry(log);

      expect(Object.isFrozen(entry)).toBe(true);
      expect(() => {
        (entry as any).action = 'tampered';
      }).toThrow();
    });
  });

  describe('verifyIntegrity', () => {
    it('should return true for a valid chain', () => {
      logEntry(log);
      logEntry(log, { delegationId: 'del-2' });
      logEntry(log, { delegationId: 'del-3' });

      const report = log.verifyIntegrity();

      expect(report.valid).toBe(true);
      expect(report.totalEntries).toBe(3);
      expect(report.checkedEntries).toBe(3);
      expect(report.firstBrokenAt).toBeNull();
      expect(report.brokenEntries).toEqual([]);
    });

    it('should detect tampering (modified entry)', () => {
      logEntry(log);
      logEntry(log, { delegationId: 'del-2' });

      // Tamper with the internal entries array by replacing a frozen entry
      const entries = (log as any).entries;
      const tampered = { ...entries[0], action: 'tampered-action' };
      entries[0] = tampered;

      const report = log.verifyIntegrity();

      expect(report.valid).toBe(false);
      expect(report.brokenEntries.length).toBeGreaterThan(0);
    });

    it('should detect missing entries (broken sequence)', () => {
      logEntry(log);
      logEntry(log, { delegationId: 'del-2' });
      logEntry(log, { delegationId: 'del-3' });

      // Remove the middle entry to break the sequence
      const entries = (log as any).entries;
      entries.splice(1, 1);

      const report = log.verifyIntegrity();

      expect(report.valid).toBe(false);
      expect(report.brokenEntries.length).toBeGreaterThan(0);
    });
  });

  describe('filter', () => {
    beforeEach(() => {
      logEntry(log, {
        type: 'delegation.requested',
        delegationId: 'del-A',
        from: 'pm-agent',
        to: 'backend-agent',
      });
      logEntry(log, {
        type: 'delegation.completed',
        delegationId: 'del-A',
        from: 'backend-agent',
        to: 'pm-agent',
      });
      logEntry(log, {
        type: 'trust.updated',
        delegationId: 'del-B',
        from: 'system',
        to: 'qa-agent',
      });
      logEntry(log, {
        type: 'delegation.failed',
        delegationId: 'del-C',
        from: 'frontend-agent',
        to: 'pm-agent',
      });
    });

    it('should filter by action type', () => {
      const results = log.getLog({ type: 'delegation.requested' });

      expect(results).toHaveLength(1);
      expect(results[0].type).toBe('delegation.requested');
    });

    it('should filter by agent', () => {
      const results = log.getLog({ agentId: 'qa-agent' });

      expect(results).toHaveLength(1);
      expect(results[0].to).toBe('qa-agent');
    });

    it('should filter by delegation ID', () => {
      const results = log.getLog({ delegationId: 'del-A' });

      expect(results).toHaveLength(2);
      results.forEach((r) => expect(r.delegationId).toBe('del-A'));
    });

    it('should filter by time range', () => {
      const now = new Date();
      const past = new Date(now.getTime() - 1000);
      const future = new Date(now.getTime() + 1000);

      const results = log.getLog({
        dateRange: { from: past, to: future },
      });

      expect(results).toHaveLength(4);
    });
  });

  describe('getEntries', () => {
    it('should return all entries in order', () => {
      logEntry(log, { delegationId: 'del-1' });
      logEntry(log, { delegationId: 'del-2' });
      logEntry(log, { delegationId: 'del-3' });

      const all = log.getLog();

      expect(all).toHaveLength(3);
      expect(all[0].sequenceNumber).toBe(0);
      expect(all[1].sequenceNumber).toBe(1);
      expect(all[2].sequenceNumber).toBe(2);
      expect(all[0].delegationId).toBe('del-1');
      expect(all[1].delegationId).toBe('del-2');
      expect(all[2].delegationId).toBe('del-3');
    });

    it('should support pagination (offset and limit)', () => {
      for (let i = 0; i < 10; i++) {
        logEntry(log, { delegationId: `del-${i}` });
      }

      const page1 = log.getLog({ offset: 0, limit: 3 });
      expect(page1).toHaveLength(3);
      expect(page1[0].sequenceNumber).toBe(0);
      expect(page1[2].sequenceNumber).toBe(2);

      const page2 = log.getLog({ offset: 3, limit: 3 });
      expect(page2).toHaveLength(3);
      expect(page2[0].sequenceNumber).toBe(3);
      expect(page2[2].sequenceNumber).toBe(5);

      const lastPage = log.getLog({ offset: 8, limit: 5 });
      expect(lastPage).toHaveLength(2);
      expect(lastPage[0].sequenceNumber).toBe(8);
      expect(lastPage[1].sequenceNumber).toBe(9);
    });
  });
});
