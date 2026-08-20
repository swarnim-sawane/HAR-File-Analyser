import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import UnifiedUploader from '../UnifiedUploader';

const mocks = vi.hoisted(() => ({
  uploadFile: vi.fn(),
  cancelUpload: vi.fn(),
  startHarPreview: vi.fn(),
}));

vi.mock('../../services/chunkedUploader', () => ({
  chunkedUploader: { uploadFile: mocks.uploadFile, cancelUpload: mocks.cancelUpload },
}));

vi.mock('../../services/harPreviewClient', () => ({
  startHarPreview: mocks.startHarPreview,
  isHarPreviewValidationError: (error: unknown) => (
    typeof error === 'object' && error !== null
    && (error as { code?: unknown }).code === 'HAR_PREVIEW_VALIDATION'
  ),
}));

vi.mock('../../utils/uploadFileTypes', () => ({
  detectUploadFileType: vi.fn(async () => 'har'),
  UNIFIED_FILE_INPUT_ACCEPT: '.har,.oc,.json,.log,.txt',
}));

vi.mock('../SanitizeModal', () => ({
  default: () => <div role="dialog">Sanitize uploaded HAR</div>,
}));

describe('UnifiedUploader upload flow', () => {
  beforeEach(() => {
    mocks.uploadFile.mockReset().mockResolvedValue({
      success: true,
      fileId: 'file-1',
      jobId: 'job-1',
      fileName: 'capture.har',
      fileSize: 32,
      hash: 'safe-hash',
      message: 'uploaded',
    });
    mocks.cancelUpload.mockReset();
    const ready = Promise.reject(new Error('Local preview failed'));
    const validated = Promise.reject(new Error('Local preview failed'));
    // The mock is created before the component can attach its advisory-error
    // handlers. Mark both promises handled while preserving their rejected state.
    void ready.catch(() => undefined);
    void validated.catch(() => undefined);
    mocks.startHarPreview.mockReset().mockReturnValue({
      previewId: 'preview-1',
      ready,
      validated,
      setPhase: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
      finish: vi.fn(),
    });
  });

  it('continues the canonical upload when the local preview rejects', async () => {
    const user = userEvent.setup();
    const file = new File(
      ['{"log":{"version":"1.2","entries":[]}}'],
      'capture.har',
      { type: 'application/json' },
    );

    render(
      <UnifiedUploader
        onHarFileUpload={vi.fn()}
        onLogFileUpload={vi.fn()}
      />,
    );

    await user.upload(screen.getByLabelText('Choose Files'), file);

    await waitFor(() => expect(mocks.uploadFile).toHaveBeenCalledTimes(1));
    expect(mocks.uploadFile).toHaveBeenCalledWith(file, 'har', expect.any(Function));
    expect(await screen.findByRole('dialog')).toBeInTheDocument();
  });

  it('rejects a structurally invalid HAR, cancels upload, and removes its preview', async () => {
    const user = userEvent.setup();
    const validationError = Object.assign(new Error('HAR file contains an invalid request entry.'), {
      code: 'HAR_PREVIEW_VALIDATION',
    });
    const validated = Promise.reject(validationError);
    void validated.catch(() => undefined);
    mocks.startHarPreview.mockReturnValue({
      previewId: 'invalid-preview',
      ready: Promise.resolve(),
      validated,
      setPhase: vi.fn(),
      fail: vi.fn(),
      cancel: vi.fn(),
      finish: vi.fn(),
    });
    mocks.uploadFile.mockImplementation(async () => {
      await new Promise((resolve) => window.setTimeout(resolve, 0));
      throw new Error('Upload cancelled.');
    });
    const onHarPreviewRemoved = vi.fn();
    const file = new File(['{"log":{"entries":[{}]}}'], 'invalid.har', {
      type: 'application/json',
    });

    render(
      <UnifiedUploader
        onHarFileUpload={vi.fn()}
        onLogFileUpload={vi.fn()}
        onHarPreviewRemoved={onHarPreviewRemoved}
      />,
    );
    await user.upload(screen.getByLabelText('Choose Files'), file);

    expect(await screen.findByText(/all har uploads failed/i)).toHaveTextContent(
      /invalid request entry/i,
    );
    expect(mocks.cancelUpload).toHaveBeenCalledWith(file, 'har');
    expect(onHarPreviewRemoved).toHaveBeenCalledWith('invalid-preview', 'failed');
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
