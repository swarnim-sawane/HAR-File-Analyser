import React from 'react';
import { fireEvent, render, waitFor } from '@testing-library/react';
import ConsoleLogUploader from '../ConsoleLogUploader';
import { chunkedUploader } from '../../services/chunkedUploader';

vi.mock('../../services/chunkedUploader', () => ({
  chunkedUploader: {
    uploadFile: vi.fn(),
  },
}));

vi.mock('../../services/recentFilesStore', () => ({
  restoreRecentFile: vi.fn(),
}));

describe('ConsoleLogUploader', () => {
  beforeEach(() => {
    vi.mocked(chunkedUploader.uploadFile).mockReset();
  });

  it('routes medium console logs directly to local parsing instead of backend upload', async () => {
    const onFileUpload = vi.fn();
    const { container } = render(<ConsoleLogUploader onFileUpload={onFileUpload} />);
    const input = container.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File(['log row'], 'AVBCS-41519_vm1_catalina.log', { type: 'text/plain' });
    Object.defineProperty(file, 'size', { value: 44_278_289 });

    fireEvent.change(input, { target: { files: [file] } });

    await waitFor(() => {
      expect(onFileUpload).toHaveBeenCalledWith(
        expect.objectContaining({
          fileId: expect.stringMatching(/^local_/),
          jobId: 'local',
          fileName: 'AVBCS-41519_vm1_catalina.log',
          fileSize: 44_278_289,
        }),
        file,
      );
    });
    expect(chunkedUploader.uploadFile).not.toHaveBeenCalled();
  });
});
