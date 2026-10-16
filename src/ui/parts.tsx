import type { ReactNode } from 'react';
import { Icon, type IconName } from './Icon';

export function EmptyState({ icon, title, children, action }: { icon: IconName; title: string; children?: ReactNode; action?: ReactNode }) {
  return (
    <div className="empty">
      <div className="empty-icon">
        <Icon name={icon} size={34} />
      </div>
      <h2>{title}</h2>
      {children ? <p>{children}</p> : null}
      {action}
    </div>
  );
}

export function Banner({ kind = 'info', icon, children }: { kind?: 'info' | 'warn' | 'danger' | 'ok'; icon?: IconName; children: ReactNode }) {
  const cls = kind === 'info' ? '' : ` banner-${kind}`;
  return (
    <div className={`banner${cls}`} role={kind === 'danger' || kind === 'warn' ? 'alert' : undefined}>
      {icon ? <Icon name={icon} size={20} /> : null}
      <div className="grow">{children}</div>
    </div>
  );
}

export function Segmented<T extends string>({
  value, options, onChange, label,
}: {
  value: T;
  options: { value: T; label: string }[];
  onChange: (v: T) => void;
  label: string;
}) {
  return (
    <div className="segmented" role="group" aria-label={label}>
      {options.map((o) => (
        <button key={o.value} type="button" aria-pressed={value === o.value} onClick={() => onChange(o.value)}>
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function ScreenHeader({ title, left, right, subtitle }: { title: string; subtitle?: string; left?: ReactNode; right?: ReactNode }) {
  return (
    <header className="screen-header">
      <div className="screen-header-side">{left}</div>
      <div className="screen-header-title">
        <h1>{title}</h1>
        {subtitle ? <p className="muted small">{subtitle}</p> : null}
      </div>
      <div className="screen-header-side right">{right}</div>
    </header>
  );
}

export function Field({
  label, hint, error, children, id,
}: {
  label: string;
  hint?: string;
  error?: string | null;
  children: ReactNode;
  id: string;
}) {
  return (
    <div className="field">
      <label className="field-label" htmlFor={id}>
        {label}
      </label>
      {children}
      {error ? (
        <p className="field-error" id={`${id}-err`} role="alert">
          {error}
        </p>
      ) : hint ? (
        <p className="field-hint" id={`${id}-hint`}>
          {hint}
        </p>
      ) : null}
    </div>
  );
}

export function Metric({ label, value, unit, big }: { label: string; value: string; unit?: string; big?: boolean }) {
  return (
    <div className={`metric${big ? ' metric-big' : ''}`}>
      <div className="metric-value">
        {value}
        {unit ? <span className="metric-unit"> {unit}</span> : null}
      </div>
      <div className="metric-label">{label}</div>
    </div>
  );
}
