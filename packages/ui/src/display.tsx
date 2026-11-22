import type { CSSProperties, HTMLAttributes, ReactNode, Ref } from 'react';
import { cx } from './cx';

export function Kbd({ children, className }: { children: ReactNode; className?: string }) {
  return <kbd className={cx('ui-kbd', className)}>{children}</kbd>;
}

export function Badge({ children, tone = 'neutral', dot = false, className, title }: {
  children?: ReactNode; tone?: 'neutral' | 'accent' | 'ok' | 'warn' | 'danger' | 'info'; dot?: boolean; className?: string; title?: string;
}) {
  return (
    <span className={cx('ui-badge', `ui-badge--${tone}`, className)} title={title}>
      {dot && <span className="ui-badge__dot" aria-hidden="true" />}
      {children}
    </span>
  );
}

export function Notice({ tone = 'info', title, children }: { tone?: 'info' | 'warn' | 'danger' | 'ok'; title: ReactNode; children: ReactNode }) {
  return (
    <div className={cx('ui-notice', `ui-notice--${tone}`)} role={tone === 'warn' || tone === 'danger' ? 'alert' : 'status'}>
      <strong className="ui-notice__title">{title}</strong>
      <div className="ui-notice__body">{children}</div>
    </div>
  );
}

export function SettingRow({ label, description, control, danger }: { label: ReactNode; description?: ReactNode; control: ReactNode; danger?: boolean }) {
  return (
    <div className={cx('ui-setting-row', danger && 'ui-setting-row--danger')}>
      <div className="ui-setting-row__text">
        <span className="ui-setting-row__label">{label}</span>
        {description && <span className="ui-setting-row__desc">{description}</span>}
      </div>
      {control && <div className="ui-setting-row__control">{control}</div>}
    </div>
  );
}

export function DescList({ items, className }: { items: { label: string; value: ReactNode; mono?: boolean }[]; className?: string }) {
  return (
    <dl className={cx('ui-desc-list', className)}>
      {items.map((item) => (
        <div key={item.label} style={{ display: 'contents' }}>
          <dt className="ui-desc-list__label">{item.label}</dt>
          <dd className={cx('ui-desc-list__value', item.mono && 'ui-desc-list__value--mono')}>{item.value}</dd>
        </div>
      ))}
    </dl>
  );
}

export function StatusDot({ tone = 'neutral', size = 'md', label }: { tone?: 'neutral' | 'accent' | 'success' | 'warn' | 'danger'; size?: 'sm' | 'md'; label?: string }) {
  return (
    <span className="ui-status-dot">
      <span className={cx('ui-status-dot__pip', `ui-status-dot__pip--${tone}`, `ui-status-dot__pip--${size}`)} aria-hidden={label ? undefined : true} />
      {label}
    </span>
  );
}

/** The native scroller; `autoHeight` sizes to the content up to `maxHeight`. */
export function ScrollArea({ children, className, style, viewProps, viewRef, autoHeight, maxHeight }: {
  children: ReactNode; className?: string; style?: CSSProperties; viewProps?: HTMLAttributes<HTMLElement>; viewRef?: Ref<HTMLElement>; autoHeight?: boolean; maxHeight?: number | string;
}) {
  const { className: viewClass, style: viewStyle, ...view } = viewProps ?? {};
  return (
    <div className={cx('ui-scroll', className)} style={style}>
      <div
        {...view}
        ref={viewRef as Ref<HTMLDivElement>}
        className={cx('ui-scroll__view', viewClass)}
        style={{ overflowY: 'auto', maxHeight: autoHeight ? maxHeight : undefined, height: autoHeight ? undefined : '100%', ...viewStyle }}
      >
        {children}
      </div>
    </div>
  );
}

/** A centred message where content would be: no document, no headings, no folders. */
export function EmptyState({ icon, title, children, hint, actions, size = 'sm', className }: {
  icon?: ReactNode; title?: ReactNode; children?: ReactNode; hint?: ReactNode; actions?: ReactNode; size?: 'sm' | 'lg'; className?: string;
}) {
  return (
    <div className={cx('ui-empty', `ui-empty--${size}`, className)}>
      {icon && <div className="ui-empty__icon" aria-hidden="true">{icon}</div>}
      {title && <h2 className="ui-empty__title">{title}</h2>}
      {children && <div className="ui-empty__text">{children}</div>}
      {hint && <p className="ui-empty__hint">{hint}</p>}
      {actions && <div className="ui-empty__actions">{actions}</div>}
    </div>
  );
}
