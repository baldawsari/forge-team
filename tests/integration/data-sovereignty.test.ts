/**
 * Integration Test: Data Sovereignty Compliance
 *
 * Verifies that only Anthropic + Google providers are used, deployment region
 * is set to Riyadh, network policies enforce isolation, and no external
 * analytics services are referenced.
 */

import { describe, it, expect, vi, beforeAll } from 'vitest';
import fs from 'node:fs';
import path from 'node:path';

// Mock DB module used by model-router
vi.mock('../../gateway/src/db.js', () => ({
  query: vi.fn().mockResolvedValue({ rows: [] }),
}));

import { ModelRouter } from '../../gateway/src/model-router';

// ---------------------------------------------------------------------------
// Shared setup
// ---------------------------------------------------------------------------

const PROJECT_ROOT = path.resolve(__dirname, '../..');

// All 12 BMAD agent IDs
const ALL_AGENT_IDS = [
  'bmad-master',
  'product-owner',
  'business-analyst',
  'scrum-master',
  'architect',
  'ux-designer',
  'frontend-dev',
  'backend-dev',
  'qa-architect',
  'devops-engineer',
  'security-specialist',
  'tech-writer',
];

// ---------------------------------------------------------------------------
// Test Suite
// ---------------------------------------------------------------------------

describe('Data Sovereignty Compliance — Integration Tests', () => {
  let modelRouter: ModelRouter;

  beforeAll(() => {
    modelRouter = new ModelRouter();
  });

  // =========================================================================
  // Model Provider Restrictions
  // =========================================================================

  describe('Model Provider Restrictions', () => {
    it('should only contain Anthropic and Google models in catalog', () => {
      const catalog = modelRouter.getModelCatalog();
      const providers = new Set(Object.values(catalog).map((m) => m.provider));

      // Only 'anthropic' and 'google' are allowed
      expect(providers.size).toBe(2);
      expect(providers.has('anthropic')).toBe(true);
      expect(providers.has('google')).toBe(true);

      // Explicitly verify no banned providers
      expect(providers.has('openai' as any)).toBe(false);
      expect(providers.has('xai' as any)).toBe(false);

      // Verify no model ID contains GPT or Grok
      for (const modelId of Object.keys(catalog)) {
        expect(modelId.toLowerCase()).not.toContain('gpt');
        expect(modelId.toLowerCase()).not.toContain('grok');
      }
    });

    it('should assign every agent to Anthropic or Google models only', () => {
      const catalog = modelRouter.getModelCatalog();
      const validModelIds = new Set(Object.keys(catalog));

      for (const agentId of ALL_AGENT_IDS) {
        const assignment = modelRouter.getAgentAssignment(agentId as any);

        expect(assignment).toBeDefined();
        expect(assignment.agentId).toBe(agentId);

        // Primary and fallback must exist in catalog
        expect(validModelIds.has(assignment.primary)).toBe(true);
        expect(validModelIds.has(assignment.fallback)).toBe(true);

        // Provider must be anthropic or google
        const primaryProvider = catalog[assignment.primary].provider;
        const fallbackProvider = catalog[assignment.fallback].provider;
        expect(['anthropic', 'google']).toContain(primaryProvider);
        expect(['anthropic', 'google']).toContain(fallbackProvider);
      }
    });
  });

  // =========================================================================
  // Deployment Region Configuration
  // =========================================================================

  describe('Deployment Region Configuration', () => {
    it('should have DEPLOYMENT_REGION set to riyadh in docker-compose', () => {
      const composePath = path.resolve(PROJECT_ROOT, 'docker/docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf-8');

      // Check for DEPLOYMENT_REGION with riyadh as default
      expect(content).toContain('DEPLOYMENT_REGION');
      expect(content).toMatch(/DEPLOYMENT_REGION.*riyadh/);
    });

    it('should have DEPLOYMENT_REGION set to riyadh in k8s configmap', () => {
      const configmapPath = path.resolve(PROJECT_ROOT, 'infrastructure/k8s/configmap.yaml');
      const content = fs.readFileSync(configmapPath, 'utf-8');

      expect(content).toContain('DEPLOYMENT_REGION');
      expect(content).toMatch(/DEPLOYMENT_REGION.*"riyadh"/);
    });
  });

  // =========================================================================
  // Network Isolation
  // =========================================================================

  describe('Network Isolation', () => {
    let networkPolicies: string;

    beforeAll(() => {
      const policiesPath = path.resolve(PROJECT_ROOT, 'infrastructure/k8s/network-policies.yaml');
      networkPolicies = fs.readFileSync(policiesPath, 'utf-8');
    });

    it('should have default-deny ingress policy in k8s', () => {
      expect(networkPolicies).toContain('default-deny-ingress');
      expect(networkPolicies).toContain('podSelector: {}');
      expect(networkPolicies).toContain('Ingress');
    });

    it('should restrict postgres egress to DNS only', () => {
      // Find the deny-postgres-egress policy section
      expect(networkPolicies).toContain('deny-postgres-egress');

      // Extract the postgres egress section
      const postgresSection = networkPolicies.split('deny-postgres-egress')[1]?.split('---')[0] ?? '';
      expect(postgresSection).toContain('Egress');
      expect(postgresSection).toContain('port: 53');

      // Should NOT allow port 443 (no outbound internet for postgres)
      expect(postgresSection).not.toContain('port: 443');
    });

    it('should bind postgres and redis to localhost in docker-compose', () => {
      const composePath = path.resolve(PROJECT_ROOT, 'docker/docker-compose.yml');
      const content = fs.readFileSync(composePath, 'utf-8');

      // Postgres should be bound to 127.0.0.1
      expect(content).toMatch(/127\.0\.0\.1:5432:5432/);

      // Redis should be bound to 127.0.0.1
      expect(content).toMatch(/127\.0\.0\.1:6379:6379/);
    });
  });

  // =========================================================================
  // No External Analytics
  // =========================================================================

  describe('No External Analytics', () => {
    it('should not reference external analytics services in dashboard', () => {
      const packagePath = path.resolve(PROJECT_ROOT, 'dashboard/package.json');
      const content = fs.readFileSync(packagePath, 'utf-8');
      const pkg = JSON.parse(content);

      const allDeps = {
        ...(pkg.dependencies || {}),
        ...(pkg.devDependencies || {}),
      };

      const allDepNames = Object.keys(allDeps).map((d) => d.toLowerCase());

      // No Google Analytics
      expect(allDepNames).not.toContain('react-ga');
      expect(allDepNames).not.toContain('react-ga4');
      expect(allDepNames).not.toContain('ga-4-react');
      expect(allDepNames).not.toContain('@analytics/google-analytics');

      // No Segment
      expect(allDepNames).not.toContain('@segment/analytics-next');
      expect(allDepNames).not.toContain('analytics-node');

      // No Mixpanel
      expect(allDepNames).not.toContain('mixpanel-browser');
      expect(allDepNames).not.toContain('mixpanel');

      // No Amplitude
      expect(allDepNames).not.toContain('@amplitude/analytics-browser');

      // No Hotjar
      expect(allDepNames).not.toContain('react-hotjar');

      // No Sentry (tracking/analytics)
      expect(allDepNames).not.toContain('@sentry/nextjs');
      expect(allDepNames).not.toContain('@sentry/react');

      // No generic analytics packages
      const analyticsPackages = allDepNames.filter(
        (name) => name.includes('analytics') || name.includes('tracking') || name.includes('telemetry')
      );
      expect(analyticsPackages).toHaveLength(0);
    });
  });
});
