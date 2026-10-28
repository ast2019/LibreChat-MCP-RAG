import { useEffect } from 'react';

/** CSS variable the shell reads for its height while an on-screen keyboard is open. */
export const APP_HEIGHT_VAR = '--app-height';

/** Height the visual viewport must lose before it counts as a keyboard, not browser chrome. */
const KEYBOARD_THRESHOLD_PX = 120;

/**
 * iOS Safari ignores `interactive-widget=resizes-content` and does not shrink `100dvh` for the
 * keyboard: it pans the whole page up instead, pushing the header off screen and leaving the
 * composer floating above a gap. While the keyboard is open this pins the shell to the visual
 * viewport's height and undoes the pan; Android already resizes the layout and needs nothing.
 */
export default function useKeyboardViewport(enabled: boolean) {
  useEffect(() => {
    const viewport = typeof window !== 'undefined' ? window.visualViewport : null;
    if (!enabled || !viewport) {
      return;
    }
    const root = document.documentElement;
    let frame = 0;

    const apply = () => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(() => {
        /** A pinch zoom also shrinks the visual viewport; the layout must not follow it. */
        if (viewport.scale > 1.01) {
          return;
        }
        const keyboardOpen = window.innerHeight - viewport.height > KEYBOARD_THRESHOLD_PX;
        if (!keyboardOpen) {
          root.style.removeProperty(APP_HEIGHT_VAR);
          return;
        }
        root.style.setProperty(APP_HEIGHT_VAR, `${Math.round(viewport.height)}px`);
        if (window.scrollY !== 0) {
          window.scrollTo(0, 0);
        }
      });
    };

    viewport.addEventListener('resize', apply);
    viewport.addEventListener('scroll', apply);
    apply();
    return () => {
      cancelAnimationFrame(frame);
      viewport.removeEventListener('resize', apply);
      viewport.removeEventListener('scroll', apply);
      root.style.removeProperty(APP_HEIGHT_VAR);
    };
  }, [enabled]);
}
