import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { Table } from '../table';

describe('Table surface styling', () => {
  it('keeps table panels calm with a subtle header surface and no zebra rows', () => {
    const html = renderToStaticMarkup(
      <Table
        columns={[
          { key: 'source', label: 'Source' },
          { key: 'count', label: 'Count' },
        ]}
        rows={[
          { source: 'Codex', count: 1 },
          { source: 'OpenClaw', count: 2 },
        ]}
      />,
    );

    expect(html).toContain('bg-bg-inset');
    expect(html).not.toContain('odd:bg-transparent');
    expect(html).not.toContain('even:bg-fill-quaternary');
  });
});
