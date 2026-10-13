import React, { useEffect, useId, useRef } from 'react';
import { ACTION_BUTTON_FIRST } from '../utils/platform';

interface ConfirmDialogProps {
  title: string;
  /**
   * The button that goes ahead. Windows, macOS and GNOME all name it with a
   * verb for what happens ("Save All"), not Yes or OK.
   */
  confirmLabel: string;
  onConfirm: () => void;
  onCancel: () => void;
  children: React.ReactNode;
}

/**
 * A modal question with an action button and Cancel, in the platform's order
 * (see ACTION_BUTTON_FIRST). The action is the default button, Escape cancels.
 */
const ConfirmDialog: React.FC<ConfirmDialogProps> = ({
  title,
  confirmLabel,
  onConfirm,
  onCancel,
  children,
}) => {
  const dialogRef = useRef<HTMLDivElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const titleId = useId();

  // The default button takes the focus; what had it gets it back
  useEffect(() => {
    const previous = document.activeElement;
    confirmRef.current?.focus();
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
          : confirmRef.current;
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
    <button
      key="confirm"
      ref={confirmRef}
      className="modal-btn modal-btn-primary"
      onClick={onConfirm}
      type="button"
    >
      {confirmLabel}
    </button>
  );
  const cancelButton = (
    <button key="cancel" className="modal-btn modal-btn-secondary" onClick={onCancel} type="button">
      Cancel
    </button>
  );

  return (
    <div
      className="modal-overlay"
      // A click beside the dialog leaves the focus on its button
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) e.preventDefault();
      }}
    >
      <div className="modal" ref={dialogRef} role="alertdialog" aria-modal="true" aria-labelledby={titleId}>
        <h2 id={titleId}>{title}</h2>
        {children}
        <div className="modal-actions">
          {ACTION_BUTTON_FIRST ? [confirmButton, cancelButton] : [cancelButton, confirmButton]}
        </div>
      </div>
    </div>
  );
};

export default ConfirmDialog;
