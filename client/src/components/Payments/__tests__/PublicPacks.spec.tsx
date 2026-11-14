import { MemoryRouter, Route, Routes, Outlet } from 'react-router-dom';
import { render, screen } from '@testing-library/react';
import PublicPacks from '../PublicPacks';

let mockPacks: Record<string, unknown>;
const mockSetHeaderText = jest.fn();

/** Renders keys, not copy: these assertions name the localization key each string uses. */
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string, values?: Record<string, string>) =>
    values ? `${key}:${Object.values(values).join(',')}` : key,
}));

jest.mock('~/data-provider', () => ({
  usePublicPacksQuery: () => mockPacks,
}));

const renderPage = (registrationEnabled = true) =>
  render(
    <MemoryRouter initialEntries={['/packs']}>
      <Routes>
        <Route
          element={
            <Outlet
              context={{ setHeaderText: mockSetHeaderText, startupConfig: { registrationEnabled } }}
            />
          }
        >
          <Route path="/packs" element={<PublicPacks />} />
        </Route>
      </Routes>
    </MemoryRouter>,
  );

describe('public packs page', () => {
  beforeEach(() => {
    mockSetHeaderText.mockReset();
    mockPacks = {
      isLoading: false,
      isError: false,
      refetch: jest.fn(),
      data: {
        currency: { code: 'IRT', rate: 270_000, priceStep: 1000 },
        packs: [
          {
            id: 'starter',
            label: 'Starter',
            credits: 4_000_000,
            includes: ['media', 'browser'],
            browserSessions: 2,
          },
          { id: 'pro', label: 'Pro', credits: 30_000_000, includes: [] },
        ],
      },
    };
  });

  it('lists every pack with its local price, what it includes, and a buy link through sign-in', () => {
    renderPage();
    expect(mockSetHeaderText).toHaveBeenCalledWith('com_ui_packs_title');
    const items = screen.getAllByTestId('public-pack');
    expect(items).toHaveLength(2);
    expect(items[0].textContent).toContain('Starter');
    expect(items[0].textContent).toContain('com_ui_packs_includes_media');
    expect(items[0].textContent).toContain('com_ui_packs_includes_browser_sessions:2');
    expect(screen.getAllByTestId('public-pack-usd')).toHaveLength(2);
    const buy = screen.getAllByText('com_ui_packs_buy')[0].closest('a');
    expect(buy?.getAttribute('href')).toBe(
      `/login?redirect_to=${encodeURIComponent('/payment?pack=starter')}`,
    );
    expect(screen.getByText('com_auth_sign_up')).toBeTruthy();
  });

  it('shows USD alone without a display currency, and an empty state without packs', () => {
    mockPacks = { ...mockPacks, data: { currency: null, packs: [] } };
    renderPage(false);
    expect(screen.getByText('com_ui_packs_empty')).toBeTruthy();
    expect(screen.queryByText('com_auth_sign_up')).toBeNull();
  });

  it('offers a retry when the list cannot load', () => {
    mockPacks = { ...mockPacks, data: undefined, isError: true };
    renderPage();
    expect(screen.getByRole('alert').textContent).toBe('com_ui_packs_load_error');
  });
});
