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

describe('App documentation navigation', () => {
  beforeEach(() => {
    setPath('/');
  });

  it('navigates to the documentation page and back from the header control', async () => {
    const user = userEvent.setup();
    render(<App />);
    const pocBadge = screen.getByText(/proof of concept/i);

    expect(screen.getByText('Drop any file to get started')).toBeInTheDocument();
    expect(pocBadge).toBeInTheDocument();
    expect(pocBadge.closest('.app-header-actions')).not.toBeNull();
    expect(pocBadge.closest('.header-title-group')).toBeNull();

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
    expect(pocBadge.closest('.app-header-actions')).not.toBeNull();
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
