import { describe, it, expect, beforeEach } from 'vitest';
import { storage } from '@/lib/storage';
import { aiAssistantService, ConsequentialWriteProposal } from './ai-assistant.service';

describe('Area 5: Evidence-Grounded AI Assistance', () => {
  const org1 = 'org-ai-tenant-01';
  const org2 = 'org-ai-tenant-02';

  beforeEach(() => {
    localStorage.clear();
  });

  it('enforces tenant boundary isolation and does not expose other orgs data', async () => {
    // Populate org1 with 1 product
    storage.createProduct(org1, {
      sku: 'ORG1-CABLE',
      name: 'Org 1 Cable',
      category: 'Wires & Cables',
      uom: 'Coils',
      purchaseCost: 100,
      sellingPrice: 150,
      taxRate: 18,
      hsnCode: '8544',
      reorderThreshold: 5,
      isActive: true,
    }, 2); // low stock

    // Populate org2 with 1 different product
    storage.createProduct(org2, {
      sku: 'ORG2-PANEL',
      name: 'Org 2 Panel',
      category: 'Panels',
      uom: 'Nos',
      purchaseCost: 500,
      sellingPrice: 800,
      taxRate: 18,
      hsnCode: '8537',
      reorderThreshold: 1,
      isActive: true,
    }, 10);

    const resOrg1 = await aiAssistantService.processQuery(org1, 'owner', 'What stock is low?', true);
    expect(resOrg1.confidence).toBe('GROUNDED');
    expect(resOrg1.citations.length).toBe(1);
    expect(resOrg1.citations[0].label).toContain('ORG1-CABLE');
    expect(resOrg1.citations.some((c) => c.label.includes('ORG2-PANEL'))).toBe(false);

    const resOrg2 = await aiAssistantService.processQuery(org2, 'owner', 'What stock is low?', true);
    expect(resOrg2.confidence).toBe('GROUNDED');
    expect(resOrg2.citations.length).toBe(0); // org2 product is healthy (stock 10 > threshold 1)
  });

  it('refuses unsupported questions and refuses to fabricate missing data', async () => {
    // 1. External unsupported topic
    const extRes = await aiAssistantService.processQuery(org1, 'owner', 'What is the weather today?', true);
    expect(extRes.confidence).toBe('REFUSED_UNSUPPORTED');
    expect(extRes.refusalReason).toBe('EXTERNAL_TOPIC_NOT_SUPPORTED');
    expect(extRes.citations.length).toBe(0);

    // 2. Missing data / unknown topic
    const missingRes = await aiAssistantService.processQuery(org1, 'owner', 'Tell me about product XYZ_NONEXISTENT_999', true);
    expect(missingRes.confidence).toBe('REFUSED_UNSUPPORTED');
    expect(missingRes.refusalReason).toBe('NO_MATCHING_RECORDS_FOUND');
    expect(missingRes.answer).toMatch(/protect operational accuracy, I will not fabricate answers/i);
  });

  it('enforces role-based permissions on financial receivables queries', async () => {
    // Viewer role querying receivables without permission
    const viewerRes = await aiAssistantService.processQuery(org1, 'viewer', 'Show customer overdue receivables', true);
    expect(viewerRes.confidence).toBe('REFUSED_UNSUPPORTED');
    expect(viewerRes.refusalReason).toBe('PERMISSION_DENIED');
    expect(viewerRes.answer).toMatch(/Access Restricted/i);

    // Owner role querying receivables
    const ownerRes = await aiAssistantService.processQuery(org1, 'owner', 'Show customer overdue receivables', true);
    expect(ownerRes.confidence).toBe('GROUNDED');
  });

  it('explains calculations and links evidence citations for verified totals', async () => {
    storage.createProduct(org1, {
      sku: 'CALC-PROD-01',
      name: 'Calculating Item',
      category: 'Switchgear',
      uom: 'Nos',
      purchaseCost: 200,
      sellingPrice: 300,
      taxRate: 18,
      hsnCode: '8536',
      reorderThreshold: 10,
      isActive: true,
    }, 4);

    const res = await aiAssistantService.processQuery(org1, 'owner', 'Show inventory valuation and low stock', true);
    expect(res.confidence).toBe('GROUNDED');
    expect(res.calculations).toBeDefined();
    expect(res.calculations?.[0].formula).toContain('SUM(product.current_stock * product.purchase_cost)');
    expect(res.citations[0].url).toContain('/products?search=CALC-PROD-01');
  });

  it('enforces role checks and requires explicit user confirmation before consequential writes', async () => {
    const proposal: ConsequentialWriteProposal = {
      proposalId: 'prop-test-01',
      type: 'REPLENISHMENT_PROPOSAL',
      title: 'Order MCB Stock',
      impactSummary: 'Restocks 20 units of MCB',
      roleRequired: ['owner', 'admin', 'inventory'],
      payload: {
        items: [{ productId: 'p1', sku: 'MCB-1', name: 'MCB 1', qty: 20, uom: 'Nos' }],
      },
    };

    // Viewer attempting to confirm write -> must throw permission error
    await expect(
      aiAssistantService.confirmConsequentialWrite(org1, 'viewer', proposal, true)
    ).rejects.toThrow(/Role "viewer" is not permitted to confirm this action/i);

    // Authorized inventory role confirming write -> succeeds
    const confirmRes = await aiAssistantService.confirmConsequentialWrite(org1, 'inventory', proposal, true);
    expect(confirmRes.success).toBe(true);

    const auditEvents = storage.getAuditEvents(org1);
    expect(auditEvents.some((e) => e.action === 'AI_CONSEQUENTIAL_WRITE_CONFIRMED')).toBe(true);
  });
});
