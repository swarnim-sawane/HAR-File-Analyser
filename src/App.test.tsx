import React from 'react';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import App from './App';

vi.mock('./components/UnifiedUploader', () => ({
  default: () => <div>Drop any file to get started</div>,
}));

vi.mock('./components/FileUploader', () => ({
  default: () => <div>HAR uploader mock</div>,
}));

vi.mock('./components/ConsoleLogUploader', () => ({
  default: () => <div>Console uploader mock</div>,
}));

vi.mock('./components/HarTabContent', () => ({
  default: () => <div>HAR tab content mock</div>,
}));

vi.mock('./components/ConsoleLogTabContent', () => ({
  default: () => <div>Console tab content mock</div>,
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
  it('mounts the compare workspace inside a persistent shell wrapper', () => {
    render(<App />);

    const compareWrapper = screen.getByTestId('har-compare').closest('.compare-wrapper');

    expect(compareWrapper).not.toBeNull();
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
