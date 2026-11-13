import { render, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { InventoryValuationBarChart } from './InventoryValuationBarChart';

describe('InventoryValuationBarChart', () => {
  it('labels the SKU count as belonging to the displayed brand subset', () => {
    render(
      <InventoryValuationBarChart
        data={[
          { brand: 'A', totalValue: 500, skuCount: 2, totalUnits: 8 },
          { brand: 'B', totalValue: 250, skuCount: 3, totalUnits: 5 },
        ]}
      />
    );

    expect(screen.getByText('5 SKUs across displayed brands')).toBeInTheDocument();
    expect(screen.queryByText(/Active SKUs/)).not.toBeInTheDocument();
  });
});
