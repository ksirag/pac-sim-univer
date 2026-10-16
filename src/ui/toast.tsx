import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

export interface ToastAction {
  label: string;
  onClick: () => void;
}
interface ToastItem {
  id: number;
  message: string;
  kind: 'info' | 'error';
  action?: ToastAction;
}
interface ToastApi {
  show: (message: string, options?: { kind?: 'info' | 'error'; action?: ToastAction; ms?: number }) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('ToastProvider отсутствует');
  return ctx;
}

export function ToastProvider({ children, withNav }: { children: ReactNode; withNav: boolean }) {
  const [items, setItems] = useState<ToastItem[]>([]);
  const counter = useRef(0);

  const dismiss = useCallback((id: number) => setItems((list) => list.filter((t) => t.id !== id)), []);
  const show = useCallback<ToastApi['show']>(
    (message, options = {}) => {
      counter.current += 1;
      const id = counter.current;
      setItems((list) => [...list.slice(-2), { id, message, kind: options.kind ?? 'info', action: options.action }]);
      window.setTimeout(() => dismiss(id), options.ms ?? (options.action ? 7000 : 4500));
    },
    [dismiss],
  );
  const api = useMemo(() => ({ show }), [show]);

  return (
    <ToastContext.Provider value={api}>
      {children}
      <div className={`toasts${withNav ? '' : ' no-nav'}`} role="status" aria-live="polite">
        {items.map((t) => (
          <div key={t.id} className={`toast ${t.kind === 'error' ? 'error' : ''}`}>
            <span className="grow">{t.message}</span>
            {t.action ? (
              <button
                type="button"
                onClick={() => {
                  t.action?.onClick();
                  dismiss(t.id);
                }}
              >
                {t.action.label}
              </button>
            ) : null}
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  );
}
