import { MemoryRouter } from 'react-router-dom';
import userEvent from '@testing-library/user-event';
import { render, screen } from '@testing-library/react';
import Checkout from '../Checkout';

const mockMutate = jest.fn();
const mockRefetch = jest.fn();
let mockOptions: Record<string, unknown>;
let mockCheckout: Record<string, unknown>;
let mockStartupConfig: Record<string, unknown> | undefined;

/** Renders keys, not copy: these assertions name the localization key each string uses. */
jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => (key: string) => key,
}));

jest.mock('~/data-provider', () => ({
  useGetStartupConfig: () => ({ data: mockStartupConfig }),
  usePaymentOptionsQuery: () => mockOptions,
  usePaymentCheckoutMutation: () => mockCheckout,
}));

const options = {
  enabled: true,
  gateways: [
    { id: 'zarinpal', sandbox: false },
    { id: 'idpay', sandbox: true },
  ],
  packs: [
    { id: 'starter', label: 'Starter', credits: 2_000_000, amountRial: 5_390_000 },
    { id: 'pro', label: 'Pro', credits: 15_000_000, amountRial: 40_430_000, description: 'Best' },
  ],
};

const renderCheckout = (onRedirect = jest.fn(), path = '/payment') =>
  render(
    <MemoryRouter initialEntries={[path]}>
      <Checkout onRedirect={onRedirect} />
    </MemoryRouter>,
  );

describe('payment Checkout', () => {
  beforeEach(() => {
    mockMutate.mockReset();
    mockOptions = { data: options, isLoading: false, isError: false, refetch: mockRefetch };
    mockCheckout = { mutate: mockMutate, isLoading: false, isError: false, isSuccess: false };
    mockStartupConfig = undefined;
  });

  it('still lists every pack with its price while online payment is off', () => {
    mockOptions = { ...mockOptions, data: { enabled: false, gateways: [], packs: [] } };
    mockStartupConfig = {
      interface: { currency: { code: 'IRT', rate: 270_000, priceStep: 1000 } },
      balance: {
        packs: [
          { id: 'starter', label: 'Starter', credits: 4_000_000 },
          { id: 'pro', label: 'Pro', credits: 30_000_000 },
        ],
        purchaseUrl: 'https://t.me/support',
      },
    };
    renderCheckout();

    const packs = screen.getAllByTestId('payment-pack');
    expect(packs).toHaveLength(2);
    expect(packs[0]).toHaveTextContent('Starter');
    expect(screen.getAllByTestId('pack-usd')[0]).toHaveTextContent('com_ui_payment_pack_usd');
    expect(screen.getByText('com_ui_payment_offline_note')).toBeInTheDocument();
    expect(screen.getByRole('link', { name: 'com_ui_balance_buy_pack' })).toHaveAttribute(
      'href',
      'https://t.me/support',
    );
    expect(screen.queryByRole('button', { name: /com_ui_payment_pay/ })).not.toBeInTheDocument();
  });

  it('shows skeletons while loading', () => {
    mockOptions = { isLoading: true };
    renderCheckout();
    expect(screen.getByLabelText(/loading/i)).toHaveAttribute('aria-busy', 'true');
  });

  it('offers a retry when the packs cannot load', async () => {
    mockOptions = { isLoading: false, isError: true, refetch: mockRefetch };
    renderCheckout();
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_payment_load_error');
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_payment_retry' }));
    expect(mockRefetch).toHaveBeenCalled();
  });

  it('explains when online payment is off', () => {
    mockOptions = { data: { enabled: false, gateways: [], packs: [] }, isLoading: false };
    renderCheckout();
    expect(screen.getByText('com_ui_payment_unavailable')).toBeInTheDocument();
  });

  it('lists server-priced packs in tomans and keeps Pay disabled until one is picked', () => {
    renderCheckout();
    const rows = screen.getAllByTestId('payment-pack');
    expect(rows[0]).toHaveTextContent('Starter');
    expect(rows[0]).toHaveTextContent('۵۳۹٬۰۰۰ تومان');
    expect(rows[1]).toHaveTextContent('۴٬۰۴۳٬۰۰۰ تومان');
    expect(screen.getByRole('button', { name: 'com_ui_payment_pay_plain' })).toBeDisabled();
    expect(screen.getByText('com_ui_payment_select_hint')).toBeInTheDocument();
  });

  it('checks out the chosen pack and gateway, then redirects', async () => {
    const onRedirect = jest.fn();
    mockMutate.mockImplementation((_payload, handlers) =>
      handlers.onSuccess({ orderId: 'o1', redirectUrl: 'https://gw.example/pay', amountRial: 1 }),
    );
    renderCheckout(onRedirect);
    await userEvent.click(screen.getByRole('radio', { name: /Pro/ }));
    await userEvent.click(screen.getByRole('radio', { name: 'com_ui_payment_gateway_idpay' }));
    expect(screen.getByText('com_ui_payment_sandbox')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'com_ui_payment_pay' }));
    expect(mockMutate).toHaveBeenCalledWith(
      { packId: 'pro', gateway: 'idpay' },
      expect.any(Object),
    );
    expect(onRedirect).toHaveBeenCalledWith('https://gw.example/pay');
  });

  it('preselects the pack from the retry link', () => {
    renderCheckout(jest.fn(), '/payment?pack=starter');
    expect(screen.getByRole('radio', { name: /Starter/ })).toBeChecked();
  });

  it('shows the localized error for the returned code', () => {
    mockCheckout = {
      mutate: mockMutate,
      isLoading: false,
      isError: true,
      isSuccess: false,
      error: { response: { data: { error: { code: 'gateway_unreachable' } } } },
    };
    renderCheckout();
    expect(screen.getByRole('alert')).toHaveTextContent('com_ui_payment_error_gateway_unreachable');
  });
});
