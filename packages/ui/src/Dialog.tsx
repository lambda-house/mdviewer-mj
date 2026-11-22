import { useEffect, useId, useRef, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { X } from 'lucide-react';
import { Button } from './Button';
import { cx } from './cx';
import { ACTION_BUTTON_FIRST } from './platform';

const FOCUSABLE = 'a[href],button:not([disabled]),input:not([disabled]),select:not([disabled]),textarea:not([disabled]),[tabindex]:not([tabindex="-1"])';

export interface DialogProps {
  open: boolean;
  onClose: () => void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  /** lg: a wider dialog with more room, for forms. */
  size?: 'md' | 'lg';
  /** spread: footer items at both ends (a secondary action left, the main ones right). */
  footerLayout?: 'end' | 'spread';
}

/** A modal dialog with a title and a close button. Escape closes, Tab stays inside. */
export function Dialog({ open, onClose, title, children, footer, size = 'md', footerLayout = 'end' }: DialogProps) {
  const panel = useRef<HTMLDivElement>(null);
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;
  const titleId = `${useId()}-title`;

  useEffect(() => {
    if (!open) return;
    const restore = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    (panel.current?.querySelector<HTMLElement>(FOCUSABLE) ?? panel.current)?.focus();
    const onKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (!e.defaultPrevented) { e.preventDefault(); onCloseRef.current(); }
        return;
      }
      if (e.key !== 'Tab' || !panel.current) return;
      const nodes = [...panel.current.querySelectorAll<HTMLElement>(FOCUSABLE)].filter((n) => n.offsetParent !== null || n === document.activeElement);
      if (!nodes.length) { e.preventDefault(); panel.current.focus(); return; }
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (e.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { e.preventDefault(); last.focus(); }
      else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
    };
    document.addEventListener('keydown', onKeyDown);
    return () => { document.removeEventListener('keydown', onKeyDown); restore?.focus(); };
  }, [open]);

  if (!open) return null;
  return createPortal(
    <div className="ui-dialog__backdrop" onMouseDown={(e) => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panel} role="dialog" aria-modal="true" aria-labelledby={titleId} tabIndex={-1} className={cx('ui-dialog', size === 'lg' && 'ui-dialog--lg')}>
        <div className="ui-dialog__header">
          <div id={titleId} className="ui-dialog__title">{title}</div>
          <Button variant="ghost" size="sm" aria-label="Close dialog" icon={<X size={16} />} onClick={onClose} />
        </div>
        <div className="ui-dialog__body">{children}</div>
        {footer && <div className={cx('ui-dialog__footer', footerLayout === 'spread' && 'ui-dialog__footer--spread')}>{footer}</div>}
      </div>
    </div>,
    document.body,
  );
}

export interface ConfirmDialogProps {
  title: string;
  /**
   * The button that goes ahead. Windows, macOS and GNOME all name it with a
   * verb for what happens ("Save All"), not Yes or OK.
   */
  confirmLabel: string;
  /** The action throws something away: it is drawn as such and Cancel is the default button. */
  destructive?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  children: ReactNode;
}

/**
 * A modal question with an action button and Cancel, in the platform's order
 * (see ACTION_BUTTON_FIRST). The default button has the focus and Enter
 * presses it; Escape cancels. No key reaches the app while it is open.
 */
export function ConfirmDialog({ title, confirmLabel, destructive = false, onConfirm, onCancel, children }: ConfirmDialogProps) {
  const dialogRef = useRef<HTMLDivElement>(null);
  const defaultRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // The default button takes the focus; what had it gets it back
  useEffect(() => {
    const previous = document.activeElement;
    defaultRef.current?.focus();
    return () => {
      if (previous instanceof HTMLElement && previous.isConnected) previous.focus();
    };
  }, []);

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Modal: no key reaches the app's shortcuts
      e.stopPropagation();

      if (e.key === 'Escape') {
        e.preventDefault();
        onCancel();
      } else if (e.key === 'Enter') {
        // The focused button, or the default one when the focus is elsewhere
        e.preventDefault();
        const focused = document.activeElement;
        const button = focused instanceof HTMLButtonElement && dialogRef.current?.contains(focused)
          ? focused
          : defaultRef.current;
        button?.click();
      } else if (e.key === 'Tab' || e.key === 'ArrowLeft' || e.key === 'ArrowRight') {
        // The focus moves between the dialog's buttons only
        e.preventDefault();
        const buttons = Array.from(dialogRef.current?.querySelectorAll('button') ?? []);
        const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
        const back = e.key === 'ArrowLeft' || (e.key === 'Tab' && e.shiftKey);
        buttons[(current + (back ? -1 : 1) + buttons.length) % buttons.length]?.focus();
      } else if (e.ctrlKey || e.metaKey) {
        // Nor the webview's own (print, find, reload)
        e.preventDefault();
      }
    };

    window.addEventListener('keydown', handleKeyDown, true);
    return () => window.removeEventListener('keydown', handleKeyDown, true);
  }, [onCancel]);

  const confirmButton = (
    <Button key="confirm" ref={destructive ? undefined : defaultRef} variant={destructive ? 'destructive' : 'primary'} onClick={onConfirm}>
      {confirmLabel}
    </Button>
  );
  const cancelButton = (
    <Button key="cancel" ref={destructive ? defaultRef : undefined} variant="secondary" onClick={onCancel}>
      Cancel
    </Button>
  );

  return (
    <div
      className="ui-dialog__backdrop"
      // A click beside the dialog leaves the focus on its button
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div className="ui-dialog ui-dialog--confirm" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId} className="ui-dialog__title">{title}</h2>
        <div className="ui-dialog__body">{children}</div>
        <div className="ui-dialog__actions">
          {ACTION_BUTTON_FIRST ? [confirmButton, cancelButton] : [cancelButton, confirmButton]}
        </div>
      </div>
    </div>
  );
}
