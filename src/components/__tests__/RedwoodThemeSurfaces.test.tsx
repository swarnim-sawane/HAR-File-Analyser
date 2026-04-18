import React from 'react';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import DocumentationPage from '../DocumentationPage';
import FloatingAiChat from '../FloatingAiChat';
import HarCompare from '../HarCompare';
import HarSanitizer from '../HarSanitizer';
import { makeHarJson } from '../../test-utils/fixtures';

const originalFetch = global.fetch;

const setPath = (path: string) => {
  window.history.replaceState({}, '', path);
};

describe('Redwood theme surface smoke tests', () => {
  beforeEach(() => {
    document.documentElement.dataset.theme = 'redwood';
    document.documentElement.style.colorScheme = 'light';
    window.localStorage.setItem('theme', 'redwood');
    setPath('/');

    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ connected: true }),
    } as Response) as typeof fetch;
  });

  afterAll(() => {
    if (originalFetch) {
      global.fetch = originalFetch;
    }
  });

  it('renders the documentation page in Redwood mode', () => {
    render(<DocumentationPage onBackToAnalyzer={vi.fn()} />);

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(screen.getByRole('heading', { name: /har file analyzer documentation/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /documentation section navigation/i })).toBeInTheDocument();
  });

  it('renders the compare workspace in Redwood mode for both upload and active views', async () => {
    const user = userEvent.setup();
    const fileA = new File([makeHarJson()], 'baseline.har', { type: 'application/json' });
    const fileB = new File([makeHarJson()], 'comparison.har', { type: 'application/json' });
    const { container } = render(
      <div className="compare-wrapper">
        <HarCompare />
      </div>
    );

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(container.querySelector('.compare-wrapper')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /compare two captures with a clearer executive lens/i })).toBeInTheDocument();
    expect(screen.getByText(/upload baseline har/i)).toBeInTheDocument();
    expect(screen.getByText(/upload comparison har/i)).toBeInTheDocument();

    const fileInputs = container.querySelectorAll('input[type="file"][accept=".har"]');
    expect(fileInputs).toHaveLength(2);

    await user.upload(fileInputs[0] as HTMLInputElement, fileA);
    await user.upload(fileInputs[1] as HTMLInputElement, fileB);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /compare captures/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /stats overview/i })).toBeInTheDocument();
    expect(screen.getByText(/performance and stability deltas/i)).toBeInTheDocument();
  });

  it('renders the sanitizer workspace in Redwood mode for both upload and working views', async () => {
    const user = userEvent.setup();
    const file = new File([makeHarJson()], 'session.har', { type: 'application/json' });
    const { container } = render(
      <div className="sanitizer-wrapper">
        <HarSanitizer />
      </div>
    );

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(container.querySelector('.sanitizer-wrapper')).not.toBeNull();
    expect(screen.getByRole('heading', { name: /har sanitizer/i })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: /upload a har file and sanitize it before sharing/i })).toBeInTheDocument();

    const fileInput = container.querySelector('#sanitizer-file-input') as HTMLInputElement | null;
    expect(fileInput).not.toBeNull();

    await user.upload(fileInput as HTMLInputElement, file);

    await waitFor(() => {
      expect(screen.getByRole('heading', { name: /sanitized preview/i })).toBeInTheDocument();
    });

    expect(screen.getByRole('heading', { name: /select items to sanitize/i })).toBeInTheDocument();
    expect(screen.getByText(/active file/i)).toBeInTheDocument();
  });

  it('renders the AI chat surface in Redwood mode', async () => {
    const user = userEvent.setup();
    render(<FloatingAiChat />);

    await user.click(screen.getByRole('button', { name: /ai assistant/i }));

    expect(screen.getByRole('heading', { name: /ai assistant/i })).toBeInTheDocument();
    expect(screen.getByPlaceholderText(/ask about this har file/i)).toBeInTheDocument();
    expect(screen.getByText(/i'm analyzing your har file/i)).toBeInTheDocument();
  });
});
