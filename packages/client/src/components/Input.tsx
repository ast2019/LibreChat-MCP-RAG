import * as React from 'react';
import { fieldControl, fieldEmbedded, fieldFlush, fieldInvalid } from './Field';
import { floatingField, floatingFieldCenter } from './floating';
import { cn } from '~/utils';
import './Field.css';

/** `title` edits a heading in place, so the field takes the heading's type scale. `inline` shares
 *  a row with icon Buttons, so it takes their height role and the row stays one height when a
 *  theme sizes fields and buttons apart. `floating` is the sign-in form field whose label rests
 *  inside it and lifts on focus, and `floating-center` centers its value for a centered form
 *  (pair it with `floatingLabelCenter`). `flush` draws no border or ring because the surrounding frame owns
 *  the indicator, and `embedded` fills a list or popover row edge to edge. */
export const INPUT_VARIANTS: Record<
  | 'default'
  | 'inline'
  | 'title'
  | 'title-sm'
  | 'floating'
  | 'floating-center'
  | 'flush'
  | 'embedded',
  string
> = {
  default: '',
  inline: 'h-theme-button',
  title: 'h-theme-field-lg text-2xl font-semibold tracking-tight',
  'title-sm': 'text-base font-semibold tracking-tight',
  floating: floatingField,
  'floating-center': floatingFieldCenter,
  flush: fieldFlush,
  embedded: fieldEmbedded,
};

/** Both floating variants rest their label on an empty placeholder, which is what `peer-placeholder-shown` reads. */
export const isFloatingVariant = (variant: keyof typeof INPUT_VARIANTS): boolean =>
  variant === 'floating' || variant === 'floating-center';

export type InputProps = React.InputHTMLAttributes<HTMLInputElement> & {
  colorTransition?: boolean;
  variant?: keyof typeof INPUT_VARIANTS;
};

const Input: React.ForwardRefExoticComponent<InputProps & React.RefAttributes<HTMLInputElement>> =
  React.forwardRef<HTMLInputElement, InputProps>(
    ({ className, colorTransition, variant = 'default', ...props }, ref) => {
      return (
        <input
          className={cn(
            fieldControl,
            'ring-offset-surface-primary',
            fieldInvalid,
            INPUT_VARIANTS[variant],
            colorTransition && 'transition-colors',
            className ?? '',
          )}
          ref={ref}
          placeholder={isFloatingVariant(variant) ? ' ' : undefined}
          {...props}
        />
      );
    },
  );

Input.displayName = 'Input';

export { Input };
