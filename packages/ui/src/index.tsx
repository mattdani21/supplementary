import type { HTMLAttributes, LabelHTMLAttributes, ReactNode } from 'react';

export interface EmptyStateProps extends HTMLAttributes<HTMLElement> {
  readonly eyebrow?: string;
  readonly title: string;
  readonly children: ReactNode;
  readonly action?: ReactNode;
}

export function EmptyState({
  eyebrow,
  title,
  children,
  action,
  className,
  ...props
}: EmptyStateProps) {
  return (
    <section className={['ui-empty-state', className].filter(Boolean).join(' ')} {...props}>
      {eyebrow ? <p className="ui-empty-state__eyebrow">{eyebrow}</p> : null}
      <h2>{title}</h2>
      <div className="ui-empty-state__copy">{children}</div>
      {action ? <div className="ui-empty-state__action">{action}</div> : null}
    </section>
  );
}

export interface StatusMessageProps extends HTMLAttributes<HTMLElement> {
  readonly tone?: 'info' | 'success' | 'warning' | 'error';
  readonly title: string;
  readonly children?: ReactNode;
  readonly action?: ReactNode;
}

export function StatusMessage({
  tone = 'info',
  title,
  children,
  action,
  className,
  ...props
}: StatusMessageProps) {
  const urgent = tone === 'error';
  return (
    <section
      className={['ui-status', `ui-status--${tone}`, className].filter(Boolean).join(' ')}
      role={urgent ? 'alert' : 'status'}
      aria-live={urgent ? 'assertive' : 'polite'}
      {...props}
    >
      <strong>{title}</strong>
      {children ? <div className="ui-status__copy">{children}</div> : null}
      {action ? <div className="ui-status__action">{action}</div> : null}
    </section>
  );
}

export interface FieldProps extends LabelHTMLAttributes<HTMLLabelElement> {
  readonly label: string;
  readonly hint?: string;
  readonly error?: string;
  readonly children: ReactNode;
}

export function Field({ label, hint, error, children, className, ...props }: FieldProps) {
  return (
    <label className={['ui-field', className].filter(Boolean).join(' ')} {...props}>
      <span className="ui-field__label">{label}</span>
      {hint ? <span className="ui-field__hint">{hint}</span> : null}
      {children}
      {error ? (
        <span className="ui-field__error" role="alert">
          {error}
        </span>
      ) : null}
    </label>
  );
}
