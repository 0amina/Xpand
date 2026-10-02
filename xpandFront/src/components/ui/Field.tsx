import {
  useId,
  type InputHTMLAttributes,
  type ReactNode,
  type TextareaHTMLAttributes,
} from 'react';

interface FieldProps {
  label: ReactNode;
  /** Renders a muted "Optional" tag beside the label. */
  optional?: boolean;
  error?: string;
  hint?: string;
  children: ReactNode;
  htmlFor?: string;
}

/** Label + control + error/hint. The wrapper only; the control is passed in. */
export function Field({ label, optional, error, hint, children, htmlFor }: FieldProps) {
  return (
    <div className="field">
      <label className="field__label" htmlFor={htmlFor}>
        <span>{label}</span>
        {optional && <span className="field__optional">Optional</span>}
      </label>
      {children}
      {error ? (
        <span className="field__error" role="alert">
          {error}
        </span>
      ) : (
        hint && <span className="field__hint">{hint}</span>
      )}
    </div>
  );
}

interface TextFieldProps extends Omit<InputHTMLAttributes<HTMLInputElement>, 'id'> {
  label: ReactNode;
  optional?: boolean;
  error?: string;
  hint?: string;
}

export function TextField({
  label,
  optional,
  error,
  hint,
  className = '',
  ...rest
}: TextFieldProps) {
  const id = useId();
  return (
    <Field label={label} optional={optional} error={error} hint={hint} htmlFor={id}>
      <input
        id={id}
        className={`input ${error ? 'input--invalid' : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}

interface TextAreaFieldProps extends Omit<TextareaHTMLAttributes<HTMLTextAreaElement>, 'id'> {
  label: ReactNode;
  optional?: boolean;
  error?: string;
  hint?: string;
}

export function TextAreaField({
  label,
  optional,
  error,
  hint,
  className = '',
  ...rest
}: TextAreaFieldProps) {
  const id = useId();
  return (
    <Field label={label} optional={optional} error={error} hint={hint} htmlFor={id}>
      <textarea
        id={id}
        className={`input ${error ? 'input--invalid' : ''} ${className}`}
        aria-invalid={error ? true : undefined}
        {...rest}
      />
    </Field>
  );
}
