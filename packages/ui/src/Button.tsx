import type { ButtonHTMLAttributes, CSSProperties, ReactNode } from 'react';
import { forwardRef } from 'react';

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md';
  loading?: boolean;
  children: ReactNode;
}

const VARIANT_STYLES: Record<NonNullable<ButtonProps['variant']>, CSSProperties> = {
  primary: { background: 'var(--accent)', color: 'var(--accent-fg)', border: '1px solid transparent' },
  secondary: {
    background: 'var(--bg-surface)',
    color: 'var(--fg-primary)',
    border: '1px solid var(--border-strong)',
  },
  ghost: { background: 'transparent', color: 'var(--fg-primary)', border: '1px solid transparent' },
  danger: { background: 'var(--danger)', color: '#fff', border: '1px solid transparent' },
};

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(function Button(
  { variant = 'primary', size = 'md', loading = false, disabled, style, children, ...rest },
  ref,
) {
  return (
    <button
      ref={ref}
      disabled={disabled || loading}
      style={{
        display: 'inline-flex',
        alignItems: 'center',
        justifyContent: 'center',
        gap: 'var(--s-2)',
        fontFamily: 'var(--font-sans)',
        fontSize: size === 'sm' ? 'var(--text-sm)' : 'var(--text-base)',
        fontWeight: 500,
        lineHeight: 1,
        padding: size === 'sm' ? '6px 12px' : '9px 16px',
        borderRadius: 'var(--r-sm)',
        cursor: disabled || loading ? 'default' : 'pointer',
        opacity: disabled ? 0.5 : 1,
        transition: `background var(--dur-fast) var(--ease-out)`,
        ...VARIANT_STYLES[variant],
        ...style,
      }}
      {...rest}
    >
      {loading ? <Spinner size={size === 'sm' ? 12 : 14} /> : null}
      {children}
    </button>
  );
});

export function Spinner({ size = 16 }: { size?: number }) {
  return (
    <span
      role="progressbar"
      aria-label="Loading"
      style={{
        width: size,
        height: size,
        borderRadius: '50%',
        border: '2px solid currentColor',
        borderTopColor: 'transparent',
        display: 'inline-block',
        animation: 'flow-spin 0.7s linear infinite',
      }}
    />
  );
}

export function Kbd({ children }: { children: ReactNode }) {
  return (
    <kbd
      style={{
        fontFamily: 'var(--font-sans)',
        fontSize: 'var(--text-xs)',
        fontWeight: 500,
        color: 'var(--fg-secondary)',
        background: 'var(--bg-sunken)',
        border: '1px solid var(--border-strong)',
        borderBottomWidth: 2,
        borderRadius: 'var(--r-sm)',
        padding: '2px 6px',
      }}
    >
      {children}
    </kbd>
  );
}
