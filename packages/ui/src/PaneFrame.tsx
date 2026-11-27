import type { HTMLAttributes, ReactNode } from 'react';
import { cx } from './cx';

export interface PaneFrameProps extends Omit<HTMLAttributes<HTMLElement>, 'title'> {
  /** The element of the pane: an aside for side panels. */
  as?: 'aside' | 'section' | 'div';
  /** Shown in the header, upper-case ("Files", "Contents"). */
  title: ReactNode;
  /** Buttons at the right of the header (use Button variant="ghost" size="xs"). */
  tools?: ReactNode;
  children?: ReactNode;
}

/** A pane with the one header style of every panel: title left, tools right. */
export function PaneFrame({ as: Tag = 'section', title, tools, className, children, ...rest }: PaneFrameProps) {
  return (
    <Tag {...rest} className={cx('ui-pane', className)}>
      <div className="ui-pane__header">
        <span className="ui-pane__title">{title}</span>
        {tools && <div className="ui-pane__tools">{tools}</div>}
      </div>
      {children}
    </Tag>
  );
}
