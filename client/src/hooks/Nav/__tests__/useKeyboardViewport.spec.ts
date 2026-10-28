import { renderHook } from '@testing-library/react';
import useKeyboardViewport, { APP_HEIGHT_VAR } from '../useKeyboardViewport';

class FakeViewport extends EventTarget {
  height = 800;
  scale = 1;
}

describe('useKeyboardViewport', () => {
  let viewport: FakeViewport;
  const originalViewport = window.visualViewport;

  beforeEach(() => {
    viewport = new FakeViewport();
    Object.defineProperty(window, 'visualViewport', { value: viewport, configurable: true });
    Object.defineProperty(window, 'innerHeight', { value: 800, configurable: true });
    jest.spyOn(window, 'requestAnimationFrame').mockImplementation((cb) => {
      cb(0);
      return 1;
    });
    document.documentElement.style.removeProperty(APP_HEIGHT_VAR);
  });

  afterEach(() => {
    Object.defineProperty(window, 'visualViewport', {
      value: originalViewport,
      configurable: true,
    });
  });

  const height = () => document.documentElement.style.getPropertyValue(APP_HEIGHT_VAR);

  it('pins the shell to the visual viewport while the keyboard is open', () => {
    const { unmount } = renderHook(() => useKeyboardViewport(true));
    expect(height()).toBe('');

    viewport.height = 460;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('460px');

    viewport.height = 800;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('');

    viewport.height = 460;
    viewport.dispatchEvent(new Event('resize'));
    unmount();
    expect(height()).toBe('');
  });

  it('ignores browser-chrome changes and pinch zoom', () => {
    renderHook(() => useKeyboardViewport(true));

    viewport.height = 740;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('');

    viewport.scale = 2;
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('');
  });

  it('does nothing when disabled', () => {
    renderHook(() => useKeyboardViewport(false));
    viewport.height = 400;
    viewport.dispatchEvent(new Event('resize'));
    expect(height()).toBe('');
  });
});
