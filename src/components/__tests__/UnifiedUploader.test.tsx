import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnifiedUploader from '../UnifiedUploader';

const makeRecentFile = (name: string, timestamp: number) => ({
  name,
  timestamp,
  data: new File(['test'], name, { type: 'text/plain' }),
});

const renderUploader = (recentPreviewLimit?: number) => render(
  <UnifiedUploader
    onHarFileUpload={vi.fn()}
    harRecentFiles={[
      makeRecentFile('first.har', 4000),
      makeRecentFile('second.har', 3000),
      makeRecentFile('third.har', 2000),
      makeRecentFile('fourth.har', 1000),
    ]}
    onLogFileUpload={vi.fn()}
    logRecentFiles={[]}
    recentPreviewLimit={recentPreviewLimit}
  />
);

describe('UnifiedUploader recent files preview', () => {
  it('advertises Word document uploads in the unified uploader', () => {
    renderUploader(3);

    expect(screen.getByText(/documents/i)).toBeInTheDocument();
    expect(screen.getByText(/\.pdf \/ \.docx/i)).toBeInTheDocument();
  });

  it('shows a compact recent-file preview and expands on demand', async () => {
    const user = userEvent.setup();

    renderUploader(3);

    expect(screen.getByText('first.har')).toBeInTheDocument();
    expect(screen.getByText('second.har')).toBeInTheDocument();
    expect(screen.getByText('third.har')).toBeInTheDocument();
    expect(screen.queryByText('fourth.har')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /show all recent files/i }));

    expect(screen.getByText('fourth.har')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /show fewer recent files/i })).toHaveAttribute(
      'aria-expanded',
      'true'
    );
  });

  it('shows all recent files when no preview limit is provided', () => {
    renderUploader();

    expect(screen.getByText('first.har')).toBeInTheDocument();
    expect(screen.getByText('fourth.har')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /show all recent files/i })).not.toBeInTheDocument();
  });
});
