import React from 'react';
import { act, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

const uploaderMockState = vi.hoisted(() => ({ homeProps: null as any }));

type UnifiedUploaderMockProps = {
  workspaceVisible?: boolean;
  inputId?: string;
  onHarFileUpload?: (result: {
    success: boolean;
    fileId: string;
    jobId: string;
    fileName: string;
    fileSize: number;
    hash: string;
    message: string;
    previewId?: string;
  }) => void | Promise<void>;
  onLogFileUpload?: (result: {
    success: boolean;
    fileId: string;
    jobId: string;
    fileName: string;
    fileSize: number;
    hash: string;
    message: string;
  }, sourceFile: File) => void | Promise<void>;
  onOpenExistingRecentFile?: (file: {
    name: string;
    fileType: 'har' | 'log';
  }) => boolean | Promise<boolean>;
  onHarPreviewSnapshot?: (snapshot: import('./services/progressiveHarPreview').HarPreviewSnapshot) => void;
  onHarPreviewRemoved?: (
    previewId: string,
    reason: 'completed' | 'cancelled' | 'failed',
  ) => void;
};

vi.mock('./components/UnifiedUploader', () => ({
  default: (props: UnifiedUploaderMockProps) => {
    if (props.inputId === 'unified-file-input-home') uploaderMockState.homeProps = props;
    const {
      workspaceVisible = true,
      onHarFileUpload,
      onLogFileUpload,
      onOpenExistingRecentFile,
      onHarPreviewSnapshot,
    } = props;
    return !workspaceVisible ? <div data-testid="background-uploader" /> : (
    <div>
      <div>Drop any file to get started</div>
      <button
        type="button"
        onClick={() =>
          void onHarFileUpload?.({
            success: true,
            fileId: 'mock-har-id',
            jobId: 'mock-job-id',
            fileName: 'mock.har',
            fileSize: 128,
            hash: 'mock-hash',
            message: 'ok',
          })
        }
      >
        Load mock HAR
      </button>
      <button
        type="button"
        onClick={() =>
          void onLogFileUpload?.({
            success: true,
            fileId: 'mock-log-id',
            jobId: 'mock-log-job-id',
            fileName: 'server.log',
            fileSize: 64,
            hash: 'mock-log-hash',
            message: 'ok',
          }, new File(['2026-08-18 INFO request completed'], 'server.log', { type: 'text/plain' }))
        }
      >
        Load mock log
      </button>
      <button
        type="button"
        onClick={() => void onOpenExistingRecentFile?.({ name: 'mock.har', fileType: 'har' })}
      >
        Open recent mock HAR
      </button>
      <button
        type="button"
        onClick={() => onHarPreviewSnapshot?.({
          previewId: 'mock-preview-id',
          fileName: 'preview.har',
          fileSize: 1024,
          phase: 'uploading',
          revision: 1,
          requests: [],
          totalParsed: 0,
          skippedOversizedEntries: 0,
          isTruncated: false,
          maxRequests: 250,
        })}
      >
        Start mock HAR preview
      </button>
    </div>
    );
  },
}));

vi.mock('./components/FileUploader', () => ({
  default: () => <div>HAR uploader mock</div>,
}));

vi.mock('./components/ConsoleLogUploader', () => ({
  default: () => <div>Console uploader mock</div>,
}));

vi.mock('./components/HarTabContent', () => ({
  default: ({ fileName, isActive, fileId, previewSnapshot }: {
    fileName: string;
    isActive: boolean;
    fileId: string;
    previewSnapshot?: import('./services/progressiveHarPreview').HarPreviewSnapshot;
  }) => (
    <div data-testid={`har-content-${fileName}`} data-active={String(isActive)}>
      HAR tab content mock
      <span>{previewSnapshot ? `Preview ${previewSnapshot.previewId}` : 'No preview'}</span>
      <span>{fileId ? `Authoritative ${fileId}` : 'Authority pending'}</span>
    </div>
  ),
}));

vi.mock('./components/ConsoleLogTabContent', () => ({
  default: ({ fileName, isActive }: { fileName: string; isActive: boolean }) => (
    <div data-testid={`log-content-${fileName}`} data-active={String(isActive)}>
      Console tab content mock
    </div>
  ),
}));

vi.mock('./components/HarCompare', () => ({
  default: () => <div data-testid="har-compare">Compare mock</div>,
}));

vi.mock('./components/SanitizeModal', () => ({
  default: () => null,
}));

vi.mock('./components/BatchSanitizeModal', () => ({
  default: () => null,
}));

vi.mock('./components/HarSanitizer', () => ({
  default: () => <div>Sanitizer mock</div>,
}));

const setPath = (path: string) => {
  window.history.replaceState({}, '', path);
};

const originalMatchMedia = window.matchMedia;

const setPrefersDark = (prefersDark: boolean) => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(prefers-color-scheme: dark)' ? prefersDark : false,
      media: query,
      onchange: null,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    })),
  });
};

const resetThemeEnvironment = () => {
  window.localStorage.clear();
  delete document.documentElement.dataset.theme;
  document.documentElement.style.colorScheme = '';
};

beforeEach(() => {
  resetThemeEnvironment();
  setPrefersDark(false);
  setPath('/');
});

describe('App progressive HAR analyzer lifecycle', () => {
  it('opens a provisional analyzer tab immediately and promotes it in place', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start mock HAR preview' }));

    expect(screen.getByRole('tab', { name: /HAR file: preview\.har/i })).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('har-content-preview.har')).toHaveTextContent('Preview mock-preview-id');
    expect(screen.getByTestId('har-content-preview.har')).toHaveTextContent('Authority pending');
    expect(screen.queryByText('Drop any file to get started')).not.toBeInTheDocument();

    await act(async () => {
      await uploaderMockState.homeProps.onHarFileUpload({
        success: true,
        fileId: 'server-file-id',
        jobId: 'server-job-id',
        fileName: 'preview.har',
        fileSize: 1024,
        hash: 'server-hash',
        message: 'ready',
        previewId: 'mock-preview-id',
      });
    });

    expect(screen.getAllByRole('tab', { name: /HAR file: preview\.har/i })).toHaveLength(1);
    expect(screen.getByTestId('har-content-preview.har')).toHaveTextContent('Authoritative server-file-id');
  });

  it('removes a failed provisional tab and returns to the uploader', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: 'Start mock HAR preview' }));
    expect(screen.getByRole('tab', { name: /HAR file: preview\.har/i })).toBeInTheDocument();

    act(() => {
      uploaderMockState.homeProps.onHarPreviewRemoved?.('mock-preview-id', 'failed');
    });

    expect(screen.queryByRole('tab', { name: /HAR file: preview\.har/i })).not.toBeInTheDocument();
    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
  });

  it('keeps same-name previews distinct until their preview id is promoted', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    act(() => {
      uploaderMockState.homeProps.onHarPreviewSnapshot?.({
        previewId: 'same-name-preview',
        fileName: 'mock.har',
        fileSize: 256,
        phase: 'uploading',
        revision: 1,
        requests: [],
        totalParsed: 0,
        skippedOversizedEntries: 0,
        isTruncated: false,
        maxRequests: 250,
      });
    });

    expect(screen.getAllByRole('tab', { name: /HAR file: mock\.har/i })).toHaveLength(2);
    const activeContent = screen.getAllByTestId('har-content-mock.har')
      .find((element) => element.dataset.active === 'true');
    expect(activeContent).toHaveTextContent('Preview same-name-preview');
  });
});

afterAll(() => {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: originalMatchMedia,
  });
});

describe('App theme behavior', () => {
  it.each(['light', 'dark', 'redwood'] as const)('restores a saved %s theme on mount', (savedTheme) => {
    window.localStorage.setItem('theme', savedTheme);

    render(<App />);

    expect(screen.getByRole('img', { name: 'Oracle' })).toHaveAttribute(
      'src',
      '/themes/redwood/oracle.svg'
    );
    expect(document.documentElement.dataset.theme).toBe(savedTheme);
    expect(document.documentElement.style.colorScheme).toBe(savedTheme === 'dark' ? 'dark' : 'light');
    expect(screen.getByRole('radio', { name: new RegExp(`${savedTheme} theme`, 'i') })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('keeps a pre-mounted root dataset theme before consulting storage or media', () => {
    document.documentElement.dataset.theme = 'redwood';
    window.localStorage.setItem('theme', 'dark');
    setPrefersDark(true);

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(screen.getByRole('radio', { name: /redwood theme/i })).toHaveAttribute('aria-checked', 'true');
  });

  it.each([
    { prefersDark: false, expectedTheme: 'light' },
    { prefersDark: true, expectedTheme: 'dark' },
  ])('uses the system $expectedTheme theme when there is no saved preference', ({ prefersDark, expectedTheme }) => {
    setPrefersDark(prefersDark);

    render(<App />);

    expect(document.documentElement.dataset.theme).toBe(expectedTheme);
    expect(document.documentElement.style.colorScheme).toBe(expectedTheme);
    expect(screen.getByRole('radio', { name: new RegExp(`${expectedTheme} theme`, 'i') })).toHaveAttribute(
      'aria-checked',
      'true'
    );
  });

  it('updates the root theme and persisted preference when a theme is selected', async () => {
    const user = userEvent.setup();
    render(<App />);

    expect(screen.getByRole('radiogroup', { name: /theme/i })).toBeInTheDocument();

    await user.click(screen.getByRole('radio', { name: /redwood theme/i }));
    expect(document.documentElement.dataset.theme).toBe('redwood');
    expect(document.documentElement.style.colorScheme).toBe('light');
    expect(window.localStorage.getItem('theme')).toBe('redwood');
    expect(screen.getByRole('radio', { name: /redwood theme/i })).toHaveAttribute('aria-checked', 'true');

    await user.click(screen.getByRole('radio', { name: /dark theme/i }));
    expect(document.documentElement.dataset.theme).toBe('dark');
    expect(document.documentElement.style.colorScheme).toBe('dark');
    expect(window.localStorage.getItem('theme')).toBe('dark');
    expect(screen.getByRole('radio', { name: /dark theme/i })).toHaveAttribute('aria-checked', 'true');
  });
});

describe('App documentation navigation', () => {
  it('opens the unified uploader from the analyzer tab-bar plus button', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));

    expect(screen.getByRole('button', { name: /upload new/i })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /recent files/i })).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /open another analyzer file/i }));

    const dialog = screen.getByRole('dialog', { name: /upload/i });
    expect(within(dialog).getByText('Drop any file to get started')).toBeInTheDocument();

    await user.click(within(dialog).getByRole('button', { name: /close upload dialog/i }));
    expect(screen.queryByRole('dialog', { name: /upload/i })).not.toBeInTheDocument();
  });

  it('activates an already-open recent HAR without creating another tab', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    await user.click(screen.getByRole('button', { name: /open another analyzer file/i }));

    const dialog = screen.getByRole('dialog', { name: /upload/i });
    await user.click(within(dialog).getByRole('button', { name: /open recent mock har/i }));

    expect(screen.queryByRole('dialog', { name: /upload/i })).not.toBeInTheDocument();
    expect(screen.getAllByRole('tab', { name: /har file: mock\.har/i })).toHaveLength(1);
    expect(screen.getByRole('tab', { name: /har file: mock\.har/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('opens HAR and log evidence in one chronological tab rail and routes each tab to its analyzer', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    await user.click(screen.getByRole('button', { name: /open another analyzer file/i }));
    const dialog = screen.getByRole('dialog', { name: /upload/i });
    await user.click(within(dialog).getByRole('button', { name: /load mock log/i }));

    const tablist = screen.getByRole('tablist', { name: /open analyzer files/i });
    const tabs = within(tablist).getAllByRole('tab');
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAccessibleName(/har file: mock\.har/i);
    expect(tabs[1]).toHaveAccessibleName(/log file: server\.log/i);
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true');
    expect(screen.queryByTestId('har-content-mock.har')).not.toBeInTheDocument();
    expect(screen.getByTestId('log-content-server.log')).toHaveAttribute('data-active', 'true');
    expect(screen.getByRole('button', { name: /^analyzer$/i })).toHaveClass('active');
    expect(screen.queryByRole('button', { name: /^har$/i })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /^console$/i })).not.toBeInTheDocument();

    await user.click(tabs[0]);
    expect(tabs[0]).toHaveAttribute('aria-selected', 'true');
    expect(screen.getByTestId('har-content-mock.har')).toHaveAttribute('data-active', 'true');
    expect(screen.queryByTestId('log-content-server.log')).not.toBeInTheDocument();

    await user.click(screen.getByRole('button', { name: /^compare$/i }));
    await user.click(screen.getByRole('button', { name: /^analyzer$/i }));
    expect(screen.getByTestId('har-content-mock.har')).toHaveAttribute('data-active', 'true');

    await user.click(screen.getByRole('button', { name: /close mock\.har/i }));
    expect(screen.queryByRole('tab', { name: /har file: mock\.har/i })).not.toBeInTheDocument();
    expect(screen.getByRole('tab', { name: /log file: server\.log/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('supports keyboard navigation across analyzer file types', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    await user.click(screen.getByRole('button', { name: /open another analyzer file/i }));
    await user.click(within(screen.getByRole('dialog', { name: /upload/i })).getByRole('button', { name: /load mock log/i }));

    const logTab = screen.getByRole('tab', { name: /log file: server\.log/i });
    logTab.focus();
    await user.keyboard('{ArrowLeft}');

    expect(screen.getByRole('tab', { name: /har file: mock\.har/i })).toHaveAttribute('aria-selected', 'true');
  });

  it('mounts the compare workspace inside a persistent shell wrapper', () => {
    render(<App />);

    const compareWrapper = screen.getByTestId('har-compare').closest('.compare-wrapper');

    expect(compareWrapper).not.toBeNull();
  });

  it('resets the persistent compare shell scroll when returning to Compare', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /load mock har/i }));
    await user.click(screen.getByRole('button', { name: /^compare$/i }));

    const compareWrapper = screen.getByTestId('har-compare').closest('.compare-wrapper') as HTMLDivElement | null;
    expect(compareWrapper).not.toBeNull();

    const scrollToMock = vi.fn(({ top }: ScrollToOptions) => {
      compareWrapper!.scrollTop = Number(top ?? 0);
    });
    Object.defineProperty(compareWrapper as HTMLDivElement, 'scrollTo', {
      configurable: true,
      value: scrollToMock,
    });

    compareWrapper!.scrollTop = 420;
    scrollToMock.mockClear();

    await user.click(screen.getByRole('button', { name: /^analyzer$/i }));
    await user.click(screen.getByRole('button', { name: /^compare$/i }));

    expect(scrollToMock).toHaveBeenCalledWith({
      top: 0,
      behavior: 'auto',
    });
    expect(compareWrapper!.scrollTop).toBe(0);
  });

  it('navigates to the documentation page and back from the header control', async () => {
    const user = userEvent.setup();
    render(<App />);
    const pocBadge = screen.getByText(/proof of concept/i);

    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
    expect(pocBadge).toBeInTheDocument();
    expect(pocBadge.closest('.app-header-center')).not.toBeNull();
    expect(pocBadge.closest('.app-header-actions')).toBeNull();

    await user.click(screen.getByRole('button', { name: /documentation/i }));
    expect(screen.getByRole('heading', { name: /har file analyzer documentation/i })).toBeInTheDocument();
    expect(screen.getByText(/proof of concept/i)).toBeInTheDocument();

    await user.click(screen.getAllByRole('button', { name: /back to analyzer/i })[0]);
    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
  });

  it('renders documentation directly when the docs route is loaded first', () => {
    setPath('/docs');
    render(<App />);
    const pocBadge = screen.getByText(/proof of concept/i);

    expect(screen.getByRole('heading', { name: /har file analyzer documentation/i })).toBeInTheDocument();
    expect(pocBadge).toBeInTheDocument();
    expect(pocBadge.closest('.app-header-center')).not.toBeNull();
    expect(pocBadge.closest('.app-header-actions')).toBeNull();
    expect(screen.getByRole('heading', { name: /recommended investigation workflow/i })).toBeInTheDocument();
    expect(screen.getByRole('navigation', { name: /documentation section navigation/i })).toBeInTheDocument();
  });

  it('updates the docs hash and active nav item when a sidebar link is clicked', async () => {
    const user = userEvent.setup();
    setPath('/docs');
    render(<App />);

    const targetLink = screen.getByRole('link', { name: /main features/i });
    await user.click(targetLink);

    expect(window.location.hash).toBe('#main-features');
    expect(targetLink).toHaveAttribute('aria-current', 'location');
  });

  it('highlights the matching sidebar link when docs loads with a hash', () => {
    setPath('/docs#main-features');
    render(<App />);

    expect(screen.getByRole('link', { name: /main features/i })).toHaveAttribute('aria-current', 'location');
  });

  it('updates the visible page when browser history emits popstate', async () => {
    const user = userEvent.setup();
    render(<App />);

    await user.click(screen.getByRole('button', { name: /documentation/i }));
    expect(screen.getByRole('heading', { name: /har file analyzer documentation/i })).toBeInTheDocument();

    act(() => {
      setPath('/');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
  });

  it('updates the active docs link when browser history changes hashes', async () => {
    const user = userEvent.setup();
    setPath('/docs');
    render(<App />);

    await user.click(screen.getByRole('link', { name: /main features/i }));
    expect(screen.getByRole('link', { name: /main features/i })).toHaveAttribute('aria-current', 'location');

    act(() => {
      setPath('/docs#what-this-tool-does');
      window.dispatchEvent(new PopStateEvent('popstate'));
    });

    expect(screen.getByRole('link', { name: /what this tool does/i })).toHaveAttribute('aria-current', 'location');
  });
});
