import type { CSSProperties, ReactNode, SelectHTMLAttributes } from 'react';

/** Settings-screen primitives (BLUEPRINT §6). Token-driven, keyboard-first. */

export function SettingsRow({
  label,
  description,
  children,
}: {
  label: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <div
      style={{
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'space-between',
        gap: 'var(--s-6)',
        padding: 'var(--s-3) 0',
        borderBottom: '1px solid var(--border)',
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 'var(--text-base)', color: 'var(--fg-primary)', fontWeight: 500 }}>
          {label}
        </div>
        {description ? (
          <div style={{ fontSize: 'var(--text-sm)', color: 'var(--fg-secondary)', marginTop: 2 }}>
            {description}
          </div>
        ) : null}
      </div>
      <div style={{ flexShrink: 0 }}>{children}</div>
    </div>
  );
}

export function Switch({
  checked,
  onChange,
  'aria-label': ariaLabel,
}: {
  checked: boolean;
  onChange: (next: boolean) => void;
  'aria-label'?: string;
}) {
  return (
    <button
      role="switch"
      aria-checked={checked}
      aria-label={ariaLabel}
      onClick={() => onChange(!checked)}
      style={{
        width: 38,
        height: 22,
        borderRadius: 'var(--r-pill)',
        border: '1px solid var(--border-strong)',
        background: checked ? 'var(--accent)' : 'var(--bg-sunken)',
        position: 'relative',
        cursor: 'pointer',
        transition: 'background var(--dur-fast) var(--ease-out)',
        padding: 0,
      }}
    >
      <span
        style={{
          position: 'absolute',
          top: 2,
          left: checked ? 18 : 2,
          width: 16,
          height: 16,
          borderRadius: '50%',
          background: '#fff',
          boxShadow: 'var(--shadow-1)',
          transition: 'left var(--dur-fast) var(--ease-out)',
        }}
      />
    </button>
  );
}

export function Select(props: SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      style={{
        padding: '6px 10px',
        borderRadius: 'var(--r-sm)',
        background: 'var(--bg-surface)',
        color: 'var(--fg-primary)',
        border: '1px solid var(--border-strong)',
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-sm)',
        minWidth: 140,
        ...props.style,
      }}
    />
  );
}

export function Slider({
  value,
  min,
  max,
  step,
  onChange,
  'aria-label': ariaLabel,
}: {
  value: number;
  min: number;
  max: number;
  step: number;
  onChange: (next: number) => void;
  'aria-label'?: string;
}) {
  return (
    <input
      type="range"
      value={value}
      min={min}
      max={max}
      step={step}
      aria-label={ariaLabel}
      onChange={(e) => onChange(Number(e.target.value))}
      style={{ width: 160, accentColor: 'var(--accent)' } as CSSProperties}
    />
  );
}
