import { useState, type FormEvent } from 'react';

import { Button } from '@/components/ui/Button';
import { TextField } from '@/components/ui/Field';
import { useAuth } from '@/hooks/useAuth';
import { BASE_URL } from '@/lib/api';
import { describeError } from '@/lib/errors';

import '@/components/layout/layout.css';

export function BootLoading() {
  return (
    <div className="boot">
      <span className="boot__logo" aria-hidden="true">
        ◎
      </span>
      <span className="boot__brand">Xpand</span>
      <span className="spinner" aria-hidden="true" />
      <span className="sr-only">Signing in…</span>
    </div>
  );
}

export function BootError({ error }: { error: unknown }) {
  const { retry, isTelegram, signOut } = useAuth();
  const { title, description } = describeError(error);

  return (
    <div className="boot">
      <span className="boot__logo" aria-hidden="true">
        ⚠️
      </span>
      <strong style={{ fontSize: 'var(--x-text-md)' }}>{title}</strong>
      <p className="boot__note">{description}</p>
      <p className="boot__note">
        Backend: <code>{BASE_URL}</code>
      </p>
      <div style={{ display: 'flex', gap: 'var(--x-space-2)' }}>
        <Button onClick={retry}>Try again</Button>
        {!isTelegram && (
          <Button variant="secondary" onClick={signOut}>
            Use another id
          </Button>
        )}
      </div>
    </div>
  );
}

/**
 * Development sign-in — shown only outside Telegram, and only when no id was configured.
 *
 * Inside Telegram this screen is unreachable: the user id comes from `initData` and sign-in is
 * automatic. In a browser tab there is no initData, and the backend's auth stub identifies
 * callers by a raw `x-telegram-id` header, so a plain id field is enough to work locally.
 * `POST /api/users/login` upserts, so any numeric id works — it creates the user on first use.
 */
export function DevSignIn() {
  const { signInAs } = useAuth();
  const [id, setId] = useState('');
  const [firstName, setFirstName] = useState('Dev');
  const [error, setError] = useState<string>();
  const [busy, setBusy] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const trimmed = id.trim();

    if (!/^\d+$/.test(trimmed)) {
      setError('Enter a numeric Telegram id, e.g. 111.');
      return;
    }
    if (!firstName.trim()) {
      setError('A first name is required — the column is NOT NULL.');
      return;
    }

    setBusy(true);
    setError(undefined);
    try {
      await signInAs(trimmed, firstName.trim());
    } catch (err) {
      setError(describeError(err).description);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="boot">
      <span className="boot__logo" aria-hidden="true">
        ◎
      </span>
      <span className="boot__brand">Xpand</span>
      <p className="boot__note">
        Running outside Telegram, so there is no <code>initData</code> to identify you. Enter a
        Telegram id to use the backend's development auth stub.
      </p>

      <form className="signin-form" onSubmit={(event) => void submit(event)}>
        <TextField
          label="Telegram id"
          value={id}
          inputMode="numeric"
          placeholder="111"
          autoComplete="off"
          onChange={(event) => setId(event.target.value)}
        />
        <TextField
          label="First name"
          value={firstName}
          placeholder="Dev"
          autoComplete="off"
          onChange={(event) => setFirstName(event.target.value)}
          hint="Used only if this id is new — login upserts the user."
        />
        {error && (
          <span className="field__error" role="alert">
            {error}
          </span>
        )}
        <Button type="submit" block loading={busy}>
          Continue
        </Button>
      </form>

      <p className="boot__note">
        Set <code>VITE_DEV_TELEGRAM_ID</code> in <code>.env</code> to skip this screen. Every
        signed-in user has full access — there are no roles to configure.
      </p>
    </div>
  );
}
