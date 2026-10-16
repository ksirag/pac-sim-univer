import { useState } from 'react';
import { Sheet } from './Sheet';
import { Field } from './parts';

export const MAX_NAME = 80;

/** Шторка ввода названия (сохранение и переименование маршрута). */
export function NameSheet({
  title, initial, confirmLabel, busy, onSave, onClose, extra,
}: {
  title: string;
  initial: string;
  confirmLabel: string;
  busy?: boolean;
  onSave: (name: string) => void;
  onClose: () => void;
  extra?: React.ReactNode;
}) {
  const [name, setName] = useState(initial);
  const [touched, setTouched] = useState(false);
  const trimmed = name.trim();
  const error = trimmed.length === 0 ? 'Введите название' : trimmed.length > MAX_NAME ? `Не длиннее ${MAX_NAME} символов` : null;
  return (
    <Sheet title={title} onClose={onClose}>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          setTouched(true);
          if (!error) onSave(trimmed);
        }}
      >
        <Field label="Название" id="route-name" error={touched ? error : null}>
          <input
            id="route-name"
            className="input"
            data-autofocus
            value={name}
            maxLength={MAX_NAME + 20}
            autoComplete="off"
            autoCapitalize="sentences"
            aria-invalid={touched && !!error}
            aria-describedby={touched && error ? 'route-name-err' : undefined}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => setTouched(true)}
          />
        </Field>
        <div className="stack" style={{ marginTop: 16 }}>
          <button type="submit" className="btn btn-primary btn-lg btn-block" disabled={busy || !!error}>
            {busy ? <span className="spinner" aria-hidden /> : null}
            {confirmLabel}
          </button>
          {extra}
        </div>
      </form>
    </Sheet>
  );
}
