import React from 'react';
import userEvent from '@testing-library/user-event';
import { render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { TStartupConfig } from 'librechat-data-provider';
import PhoneSignIn from '../PhoneSignIn';

const mockRequestPhoneCode = jest.fn();
const mockVerifyPhoneCode = jest.fn();
const mockUpdateUserProfile = jest.fn();
const mockNavigate = jest.fn();

jest.mock('librechat-data-provider', () => {
  const actual = jest.requireActual('librechat-data-provider');
  return {
    ...actual,
    setTokenHeader: jest.fn(),
    dataService: {
      ...actual.dataService,
      requestPhoneCode: (...args: unknown[]) => mockRequestPhoneCode(...args),
      verifyPhoneCode: (...args: unknown[]) => mockVerifyPhoneCode(...args),
      updateUserProfile: (...args: unknown[]) => mockUpdateUserProfile(...args),
    },
  };
});

jest.mock('react-router-dom', () => ({
  ...jest.requireActual('react-router-dom'),
  useNavigate: () => mockNavigate,
}));

jest.mock('~/hooks/Auth/usePasskey', () => ({
  resolvePostLoginHref: () => '/c/new',
}));

const mockLocalize = (key: string, params?: Record<string, string>) =>
  params ? `${key}:${JSON.stringify(params)}` : key;

jest.mock('~/hooks/useLocalize', () => ({
  __esModule: true,
  default: () => mockLocalize,
}));

const axiosError = (status: number, data: unknown) =>
  Object.assign(new Error('Request failed'), {
    isAxiosError: true,
    response: { status, data },
  });

const startupConfig = {
  phoneLoginEnabled: true,
  phoneRegistrationEnabled: true,
} as TStartupConfig;

const mockNavigateDocument = jest.fn();

jest.mock('../hooks', () => ({
  ...jest.requireActual('../hooks'),
  navigateDocument: (href: string) => mockNavigateDocument(href),
}));

beforeAll(() => {
  /** jsdom lacks it; input-otp probes it for password-manager badges. */
  document.elementFromPoint = jest.fn(() => null);
});

beforeEach(() => {
  jest.clearAllMocks();
  mockRequestPhoneCode.mockResolvedValue({
    sent: true,
    cooldownSeconds: 60,
    expiresInSeconds: 120,
    codeLength: 6,
  });
});

function renderSignIn() {
  const client = new QueryClient({ defaultOptions: { mutations: { retry: false } } });
  return render(
    <QueryClientProvider client={client}>
      <PhoneSignIn startupConfig={startupConfig} />
    </QueryClientProvider>,
  );
}

async function reachCodeStep(user: ReturnType<typeof userEvent.setup>) {
  await user.type(screen.getByTestId('phone'), '۰۹۱۲ ۱۲۳ ۴۵۶۷');
  await user.click(screen.getByTestId('phone-send'));
  await screen.findByTestId('phone-otp');
}

describe('PhoneSignIn', () => {
  it('renders an LTR tel field with autocomplete', () => {
    renderSignIn();
    const input = screen.getByTestId('phone');
    expect(input).toHaveAttribute('type', 'tel');
    expect(input).toHaveAttribute('inputmode', 'tel');
    expect(input).toHaveAttribute('autocomplete', 'tel');
    expect(input).toHaveAttribute('dir', 'ltr');
    expect(screen.getByText('com_auth_phone_signup_hint')).toBeInTheDocument();
  });

  it('rejects an invalid number without calling the server', async () => {
    const user = userEvent.setup();
    renderSignIn();
    await user.type(screen.getByTestId('phone'), '021123');
    await user.click(screen.getByTestId('phone-send'));
    expect(await screen.findByRole('alert')).toHaveTextContent('com_auth_phone_error_invalid');
    expect(mockRequestPhoneCode).not.toHaveBeenCalled();
  });

  it('normalizes Persian digits, then shows the code step with a resend countdown', async () => {
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    expect(mockRequestPhoneCode).toHaveBeenCalledWith(
      expect.objectContaining({ phone: '+989121234567', purpose: 'login' }),
    );
    expect(screen.getByTestId('phone-otp')).toHaveAttribute('autocomplete', 'one-time-code');
    expect(screen.getByTestId('phone-countdown')).toHaveTextContent('com_auth_phone_resend_in');
    expect(screen.queryByTestId('phone-resend')).not.toBeInTheDocument();
  });

  it('verifies the code and enters the app for an existing account', async () => {
    mockVerifyPhoneCode.mockResolvedValue({ token: 't', user: { name: 'Sara' } });
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    await user.type(screen.getByTestId('phone-otp'), '۱۲۳۴۵۶');
    await waitFor(() =>
      expect(mockVerifyPhoneCode).toHaveBeenCalledWith({ phone: '+989121234567', code: '123456' }),
    );
    await waitFor(() => expect(mockNavigateDocument).toHaveBeenCalledWith('/c/new'));
  });

  it('asks a new account for its name, and saves it', async () => {
    mockVerifyPhoneCode.mockResolvedValue({ token: 't', user: { name: '' } });
    mockUpdateUserProfile.mockResolvedValue({ name: 'Mina' });
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    await user.type(screen.getByTestId('phone-otp'), '123456');
    const name = await screen.findByTestId('phone-name');
    await user.type(name, 'Mina');
    await user.click(screen.getByText('com_auth_phone_name_save'));
    await waitFor(() => expect(mockUpdateUserProfile).toHaveBeenCalledWith({ name: 'Mina' }));
    expect(mockNavigateDocument).toHaveBeenCalledWith('/c/new');
  });

  it('lets a new account skip the name step', async () => {
    mockVerifyPhoneCode.mockResolvedValue({ token: 't', user: {} });
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    await user.type(screen.getByTestId('phone-otp'), '123456');
    await user.click(await screen.findByText('com_auth_phone_name_skip'));
    expect(mockUpdateUserProfile).not.toHaveBeenCalled();
    expect(mockNavigateDocument).toHaveBeenCalledWith('/c/new');
  });

  it('hands a 2FA account to the code screen without reloading', async () => {
    mockVerifyPhoneCode.mockResolvedValue({ twoFAPending: true, tempToken: 'temp' });
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    await user.type(screen.getByTestId('phone-otp'), '123456');
    await waitFor(() =>
      expect(mockNavigate).toHaveBeenCalledWith('/login/2fa?tempToken=temp', { replace: true }),
    );
    expect(mockNavigateDocument).not.toHaveBeenCalled();
  });

  it('shows a localized wrong-code error with the tries left and clears the boxes', async () => {
    mockVerifyPhoneCode.mockRejectedValue(
      axiosError(400, { code: 'phone_code_invalid', attemptsRemaining: 3 }),
    );
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    await user.type(screen.getByTestId('phone-otp'), '000000');
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('com_auth_phone_error_code_invalid');
    expect(alert.textContent).toMatch(/"0":"(3|۳)"/);
    expect(screen.getByTestId('phone-otp')).toHaveValue('');
  });

  it('shows the cooldown message when a code was requested too recently', async () => {
    mockRequestPhoneCode.mockRejectedValue(
      axiosError(429, { code: 'phone_code_cooldown', retryAfterSeconds: 42 }),
    );
    const user = userEvent.setup();
    renderSignIn();
    await user.type(screen.getByTestId('phone'), '09121234567');
    await user.click(screen.getByTestId('phone-send'));
    expect(await screen.findByRole('alert')).toHaveTextContent('com_auth_phone_error_cooldown');
  });

  it('falls back to the generic message for unexpected failures', async () => {
    mockRequestPhoneCode.mockRejectedValue(axiosError(500, { message: 'stack trace' }));
    const user = userEvent.setup();
    renderSignIn();
    await user.type(screen.getByTestId('phone'), '09121234567');
    await user.click(screen.getByTestId('phone-send'));
    const alert = await screen.findByRole('alert');
    expect(alert).toHaveTextContent('com_auth_phone_error_generic');
    expect(alert).not.toHaveTextContent('stack trace');
  });

  it('returns to the number step to edit it', async () => {
    const user = userEvent.setup();
    renderSignIn();
    await reachCodeStep(user);
    await user.click(screen.getByText('com_auth_phone_edit'));
    expect(screen.getByTestId('phone')).toHaveValue('۰۹۱۲ ۱۲۳ ۴۵۶۷');
  });
});
