import type { ComponentPropsWithRef, ReactNode } from 'react';
import { cx } from './cx';

export interface ButtonProps extends Omit<ComponentPropsWithRef<'button'>, 'children'> {
  children?: ReactNode;
  /** primary: the one action that goes ahead; ghost: tools in a header or row. */
  variant?: 'primary' | 'secondary' | 'ghost' | 'destructive';
  /** xs is the 24px tool button of a pane header. */
  size?: 'xs' | 'sm' | 'md' | 'lg';
  icon?: ReactNode;
  /** Spins the icon while something runs (a refresh). */
  busy?: boolean;
}

/** A button. With only an icon it is square; give it an aria-label then. */
export function Button({ children, variant = 'secondary', size = 'md', icon, busy = false, className, type = 'button', ...rest }: ButtonProps) {
  const iconOnly = children === undefined || children === null || children === false;
  return (
    <button
      {...rest}
      type={type}
      className={cx('ui-btn', `ui-btn--${variant}`, `ui-btn--${size}`, iconOnly && 'ui-btn--icon', busy && 'ui-btn--busy', className)}
    >
      {icon && <span className="ui-btn__icon" aria-hidden="true">{icon}</span>}
      {children}
    </button>
  );
}
