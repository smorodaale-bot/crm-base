import { useState } from 'react';

export function PasswordField({
  label = 'Пароль',
  value,
  onChange,
  autoComplete = 'current-password',
  placeholder = '••••••••',
  minLength,
  required = true,
  error = '',
}) {
  const [show, setShow] = useState(false);
  return (
    <label className="auth-field">
      <span className="auth-field-label">{label}</span>
      <span className="auth-pass">
        <input
          className="auth-input"
          value={value}
          onChange={(e) => onChange(e.target.value)}
          type={show ? 'text' : 'password'}
          required={required}
          minLength={minLength}
          autoComplete={autoComplete}
          placeholder={placeholder}
        />
        <button
          type="button"
          className="auth-pass-toggle"
          aria-label={show ? 'Скрыть пароль' : 'Показать пароль'}
          onClick={() => setShow((v) => !v)}
        >
          {show ? 'Скрыть' : 'Показать'}
        </button>
      </span>
      <span className="auth-field-error">{error}</span>
    </label>
  );
}
