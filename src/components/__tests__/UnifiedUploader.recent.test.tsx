import React from 'react';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnifiedUploader from '../UnifiedUploader';

describe('UnifiedUploader recent file handling', () => {
  it('opens an existing tab without processing the recent file again', async () => {
    const user = userEvent.setup();
    const onOpenExistingRecentFile = vi.fn().mockResolvedValue(true);
    const onHarFileUpload = vi.fn();

    render(
      <UnifiedUploader
        onHarFileUpload={onHarFileUpload}
        onLogFileUpload={vi.fn()}
        onOpenExistingRecentFile={onOpenExistingRecentFile}
        harRecentFiles={[
          {
            name: 'session.har',
            timestamp: Date.now(),
            data: new File(['existing'], 'session.har', { type: 'application/json' }),
          },
        ]}
      />
    );

    await user.click(screen.getByRole('button', { name: /session\.har/i }));

    expect(onOpenExistingRecentFile).toHaveBeenCalledWith({
      name: 'session.har',
      fileType: 'har',
    });
    expect(onHarFileUpload).not.toHaveBeenCalled();
    expect(screen.queryByText(/validating har file/i)).not.toBeInTheDocument();
  });
});
