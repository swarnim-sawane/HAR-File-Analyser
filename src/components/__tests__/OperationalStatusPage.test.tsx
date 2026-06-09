import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import OperationalStatusPage from '../OperationalStatusPage';
import { apiClient } from '../../services/apiClient';
import type { OpsStatusResponse } from '../../types/ops';

vi.mock('../../services/apiClient', () => ({
  apiClient: {
    getOpsStatus: vi.fn(),
  },
}));

const mockStatus: OpsStatusResponse = {
  status: 'warning',
  color: 'amber',
  timestamp: '2026-06-09T12:00:00.000Z',
  uptimeSeconds: 3723,
  runtime: {
    nodeVersion: 'v22.12.0',
    platform: 'win32',
    pid: 1234,
  },
  checks: [
    {
      id: 'mongodb',
      label: 'MongoDB',
      status: 'ok',
      color: 'green',
      detail: 'Connected and responding to ping.',
      latencyMs: 8,
      affectsOverall: true,
    },
    {
      id: 'harQueue',
      label: 'HAR queue',
      status: 'warning',
      color: 'amber',
      detail: '1 failed job needs review.',
      latencyMs: 11,
      affectsOverall: true,
      data: { waiting: 0, active: 0, failed: 1 },
    },
    {
      id: 'qdrant',
      label: 'Qdrant',
      status: 'unknown',
      color: 'slate',
      detail: 'Optional embedding store is not connected or not configured.',
      affectsOverall: false,
    },
  ],
  storage: [
    {
      id: 'uploads',
      label: 'Upload directory',
      path: 'C:\\har\\uploads',
      status: 'ok',
      color: 'green',
      detail: 'Directory size is within the configured threshold.',
      fileCount: 2,
      sizeBytes: 1024,
      affectsOverall: false,
    },
  ],
};

describe('OperationalStatusPage', () => {
  beforeEach(() => {
    vi.mocked(apiClient.getOpsStatus).mockResolvedValue(mockStatus);
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('renders color-coded operational checks and storage details', async () => {
    const { container } = render(<OperationalStatusPage />);

    expect(await screen.findByRole('heading', { name: /operations status/i })).toBeInTheDocument();
    expect(screen.getByText('MongoDB')).toBeInTheDocument();
    expect(screen.getByText('HAR queue')).toBeInTheDocument();
    expect(screen.getByText('Qdrant')).toBeInTheDocument();
    expect(screen.getByText('Upload directory')).toBeInTheDocument();

    expect(container.querySelector('.ops-overall-chip--warning')).not.toBeNull();
    expect(container.querySelector('.ops-status-card--ok')).not.toBeNull();
    expect(container.querySelector('.ops-status-card--warning')).not.toBeNull();
    expect(container.querySelector('.ops-status-card--unknown')).not.toBeNull();
  });

  it('refreshes status on demand', async () => {
    const user = userEvent.setup();
    render(<OperationalStatusPage />);

    await screen.findByText('MongoDB');
    await user.click(screen.getByRole('button', { name: /refresh/i }));

    await waitFor(() => {
      expect(apiClient.getOpsStatus).toHaveBeenCalledTimes(2);
    });
  });
});
