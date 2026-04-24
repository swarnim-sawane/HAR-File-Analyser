import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import HarCompare from '../HarCompare';
import { makeHarJson } from '../../test-utils/fixtures';
import { HAR_FILE_INPUT_ACCEPT } from '../../utils/uploadFileTypes';

const originalFetch = global.fetch;

function getHarFileInputs(container: HTMLElement): HTMLInputElement[] {
  return Array.from(container.querySelectorAll('input[type="file"]')).filter(
    (node): node is HTMLInputElement => node instanceof HTMLInputElement && node.accept === HAR_FILE_INPUT_ACCEPT,
  );
}

describe('HarCompare', () => {
  afterEach(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    }
  });

  it('scrolls the compare workspace back to the sticky tab strip when switching tabs', async () => {
    const user = userEvent.setup();
    const fileA = new File([makeHarJson()], 'baseline.oc', { type: 'application/json' });
    const fileB = new File([makeHarJson()], 'comparison.oc', { type: 'application/json' });
    const requestAnimationFrameSpy = vi
      .spyOn(window, 'requestAnimationFrame')
      .mockImplementation((callback: FrameRequestCallback) => {
        callback(0);
        return 1;
      });

    const { container } = render(
      <div className="compare-wrapper">
        <HarCompare />
      </div>
    );

    const wrapper = container.querySelector('.compare-wrapper') as HTMLDivElement | null;
    expect(wrapper).not.toBeNull();

    const fileInputs = getHarFileInputs(container);
    expect(fileInputs).toHaveLength(2);

    await user.upload(fileInputs[0], fileA);
    await user.upload(fileInputs[1], fileB);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /compare captures/i })).toBeInTheDocument();
    });

    const stickyTabStrip = container.querySelector('.cmp-nav-shell--sticky') as HTMLElement | null;
    expect(stickyTabStrip).not.toBeNull();

    Object.defineProperty(stickyTabStrip as HTMLElement, 'offsetTop', {
      configurable: true,
      value: 348,
    });

    const scrollToMock = vi.fn();
    Object.defineProperty(wrapper as HTMLDivElement, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    });

    (wrapper as HTMLDivElement).scrollTop = 420;

    await user.click(screen.getByRole('button', { name: /ai summary/i }));

    await waitFor(() => {
      expect(scrollToMock).toHaveBeenCalledWith({
        top: 336,
        behavior: 'smooth',
      });
    });

    requestAnimationFrameSpy.mockRestore();
  });

  it('renders AI markdown inside the formatted compare text wrapper', async () => {
    const user = userEvent.setup();
    const fileA = new File([makeHarJson()], 'baseline.oc', { type: 'application/json' });
    const fileB = new File([makeHarJson()], 'comparison.oc', { type: 'application/json' });
    const markdown = '## What was broken\n\u2022 First issue\n\u25E6 Why it matters\n\u2022 Second issue';
    const chunks = [
      `data: ${JSON.stringify({ choices: [{ delta: { content: markdown } }] })}\n\n`,
      'data: [DONE]\n\n',
    ];
    let chunkIndex = 0;

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      body: {
        getReader: () => ({
          read: async () => {
            if (chunkIndex >= chunks.length) {
              return { done: true, value: undefined };
            }

            const value = new TextEncoder().encode(chunks[chunkIndex]);
            chunkIndex += 1;
            return { done: false, value };
          },
        }),
      },
    } as Response) as typeof fetch;

    const { container } = render(
      <div className="compare-wrapper">
        <HarCompare />
      </div>
    );

    const fileInputs = getHarFileInputs(container);
    expect(fileInputs).toHaveLength(2);

    await user.upload(fileInputs[0], fileA);
    await user.upload(fileInputs[1], fileB);
    await user.click(screen.getByRole('button', { name: /ai summary/i }));
    await user.click(screen.getByRole('button', { name: /run ai analysis/i }));

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /what was broken/i })).toBeInTheDocument();
    });

    expect(container.querySelector('.cmp-ai-result .cmp-ai-text')).not.toBeNull();
    expect(screen.getByText(/first issue/i)).toBeInTheDocument();
    expect(screen.getByText(/why it matters/i)).toBeInTheDocument();
    expect(screen.getByText(/second issue/i)).toBeInTheDocument();

    await waitFor(() => {
      expect(container.querySelectorAll('.cmp-ai-result .cmp-ai-text ul').length).toBeGreaterThan(1);
    });
  });
});
