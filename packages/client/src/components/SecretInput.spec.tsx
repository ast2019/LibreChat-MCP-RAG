import React from 'react';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { SecretInput } from './SecretInput';

jest.mock('./MorphIcon', () => {
  const { createMorphIconMock } = jest.requireActual('../test/mockMorphIcon');
  const { Eye, EyeOff, Copy, Check } = jest.requireActual('lucide');
  return {
    MorphIcon: createMorphIconMock([
      [Eye, 'eye'],
      [EyeOff, 'eye-off'],
      [Copy, 'copy'],
      [Check, 'check'],
    ]),
  };
});

describe('SecretInput', () => {
  beforeEach(() => {
    Object.assign(navigator, {
      clipboard: {
        writeText: jest.fn().mockResolvedValue(undefined),
      },
    });
  });

  it('shows eye icon when hidden and eye-off when visible', () => {
    render(<SecretInput value="secret" readOnly aria-label="token" />);
    const toggle = screen.getByRole('button', { name: 'Show secret' });
    expect(toggle.querySelector('[data-icon="eye"]')).not.toBeNull();

    fireEvent.click(toggle);
    expect(
      screen.getByRole('button', { name: 'Hide secret' }).querySelector('[data-icon="eye-off"]'),
    ).not.toBeNull();
  });

  it('morphs copy to check after a successful copy', async () => {
    render(<SecretInput value="secret-value" showCopy readOnly aria-label="token" />);
    const copyButton = screen.getByRole('button', { name: 'Copy to clipboard' });
    expect(copyButton.querySelector('[data-icon="copy"]')).not.toBeNull();

    fireEvent.click(copyButton);
    await waitFor(() => {
      expect(
        screen.getByRole('button', { name: 'Copied' }).querySelector('[data-icon="check"]'),
      ).not.toBeNull();
    });
    expect(navigator.clipboard.writeText).toHaveBeenCalledWith('secret-value');
  });

  /** A secret sits beside plain inputs in forms, so it composes the shared field and takes the
   *  theme's field height and focus treatment with them. */
  it('draws the shared field with its height and focus roles', () => {
    render(<SecretInput value="secret" showCopy readOnly aria-label="token" />);
    const field = screen.getByLabelText('token');

    expect(field).toHaveClass(
      'lc-field',
      'h-theme-field',
      'focus-visible:ring-focus-control',
      'theme-field-border:focus:border-border-field-focus',
      'pe-20',
    );
    expect(field).not.toHaveClass('h-10');
  });

  /** The sign-in form's field carries its edge, label and controls with it, so a form names the
   *  variant rather than restating them. */
  it('draws the floating variant with its label and show control', () => {
    render(<SecretInput id="pw" variant="floating" label="Password" />);
    const field = document.getElementById('pw');

    expect(field).toHaveClass('peer', 'rounded-theme-auth-control', 'pe-11');
    expect(field).toHaveAttribute('placeholder', ' ');
    expect(screen.getByText('Password')).toHaveClass('peer-placeholder-shown:top-1/2');
    expect(screen.getByRole('button', { name: 'Show secret' })).toHaveClass(
      'size-theme-auth-field-action',
      'rounded-xl',
    );
    expect(screen.getByRole('button', { name: 'Show secret' })).not.toHaveClass('size-7');
  });

  /** A centered value pads both sides past the show control, so centered text never runs
   *  under it, and the label centers over the field while keeping the floating motion. */
  it('centers the floating-center variant symmetrically around its controls', () => {
    render(<SecretInput id="pw" variant="floating-center" label="Password" />);
    const field = document.getElementById('pw');
    const label = screen.getByText('Password');

    expect(field).toHaveClass('peer', 'text-center', 'ps-11', 'pe-11');
    expect(field).toHaveAttribute('placeholder', ' ');
    expect(label).toHaveClass(
      'pointer-events-none',
      'mx-auto',
      'w-fit',
      'origin-center',
      'peer-focus:scale-75',
    );
    expect(label).not.toHaveClass('start-3');
    expect(screen.getByRole('button', { name: 'Show secret' })).toHaveClass(
      'size-theme-auth-field-action',
    );
  });

  it('pads both sides past the copy control when a centered field shows one', () => {
    render(<SecretInput id="pw" variant="floating-center" showCopy label="Key" />);

    expect(document.getElementById('pw')).toHaveClass('ps-20', 'pe-20');
  });

  it('keeps the start-aligned floating field padded on its control side only', () => {
    render(<SecretInput id="pw" variant="floating" label="Password" />);

    expect(document.getElementById('pw')).not.toHaveClass('ps-11', 'text-center');
  });
});
