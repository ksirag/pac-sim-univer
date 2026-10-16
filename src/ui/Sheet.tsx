import { useEffect, useRef, type ReactNode } from 'react';
import { Icon } from './Icon';
import { useBodyLock, useRestoreFocus } from './hooks';

/** Нижняя шторка. Закрывается кнопкой, Esc и касанием фона; фокус не уходит за её пределы. */
export function Sheet({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const ref = useRef<HTMLDivElement>(null);
  useBodyLock(true);
  useRestoreFocus(true);

  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus], button, input, select, textarea, a[href]')?.focus();
  }, []);

  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onClose()}>
      <div
        className="sheet"
        role="dialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onClose();
          if (e.key === 'Tab') trapFocus(e, ref.current);
        }}
      >
        <div className="sheet-head">
          <h2>{title}</h2>
          <button type="button" className="icon-btn" aria-label="Закрыть" onClick={onClose}>
            <Icon name="close" />
          </button>
        </div>
        <div className="sheet-body">{children}</div>
      </div>
    </div>
  );
}

export function ConfirmDialog({
  title, message, confirmLabel, cancelLabel = 'Отмена', danger, busy, onConfirm, onCancel, extra,
}: {
  title: string;
  message: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  busy?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
  extra?: ReactNode;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useBodyLock(true);
  useRestoreFocus(true);
  useEffect(() => {
    ref.current?.querySelector<HTMLElement>('[data-autofocus]')?.focus();
  }, []);
  return (
    <div className="overlay" onClick={(e) => e.target === e.currentTarget && onCancel()}>
      <div
        className="dialog"
        role="alertdialog"
        aria-modal="true"
        aria-label={title}
        ref={ref}
        onKeyDown={(e) => {
          if (e.key === 'Escape') onCancel();
          if (e.key === 'Tab') trapFocus(e, ref.current);
        }}
      >
        <h2>{title}</h2>
        <div className="muted">{message}</div>
        {extra}
        <div className="dialog-actions">
          <button type="button" className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`} onClick={onConfirm} disabled={busy}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            {confirmLabel}
          </button>
          <button type="button" className="btn btn-outline" onClick={onCancel} data-autofocus>
            {cancelLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function trapFocus(e: React.KeyboardEvent, root: HTMLElement | null) {
  if (!root) return;
  const items = Array.from(
    root.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'),
  );
  if (items.length === 0) return;
  const first = items[0]!;
  const last = items[items.length - 1]!;
  if (e.shiftKey && document.activeElement === first) {
    e.preventDefault();
    last.focus();
  } else if (!e.shiftKey && document.activeElement === last) {
    e.preventDefault();
    first.focus();
  }
}
