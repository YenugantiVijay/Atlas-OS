import { useEffect, useState } from 'react';
import type { SupabaseClient } from '@supabase/supabase-js';
import { ShieldCheck } from 'lucide-react';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';

type Factor = { id: string; qr?: string; secret?: string };

export function AuthenticatorChallenge({ client, name, onSignOut }: {
  client: SupabaseClient; name: string; onSignOut: () => void;
}) {
  const [factor, setFactor] = useState<Factor | null>(null);
  const [loading, setLoading] = useState(true);
  const [code, setCode] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    let active = true;
    void client.auth.mfa.listFactors().then(({ data, error }) => {
      if (error) throw error;
      if (active && data.totp[0]) setFactor({ id: data.totp[0].id });
    }).catch(() => {
      if (active) setError('Unable to load your authenticator. Try again.');
    }).finally(() => {
      if (active) setLoading(false);
    });
    return () => { active = false; };
  }, [client]);

  async function enroll() {
    if (busy) return;
    setBusy(true); setError('');
    try {
      // An unfinished enrolment has no usable QR code after a reload.
      const existing = await client.auth.mfa.listFactors();
      if (existing.error) throw existing.error;
      const verified = existing.data.totp[0];
      if (verified) { setFactor({ id: verified.id }); return; }
      for (const item of existing.data.all.filter(item => item.factor_type === 'totp' && item.status === 'unverified')) {
        const result = await client.auth.mfa.unenroll({ factorId: item.id });
        if (result.error) throw result.error;
      }
      const { data, error } = await client.auth.mfa.enroll({ factorType: 'totp', friendlyName: name });
      if (error) throw error;
      setFactor({ id: data.id, qr: data.totp.qr_code, secret: data.totp.secret });
    } catch {
      setError('The authenticator could not be set up. Please try again.');
    } finally {
      setBusy(false);
    }
  }

  async function verify(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !factor) return;
    setBusy(true); setError('');
    try {
      const result = await client.auth.mfa.challengeAndVerify({ factorId: factor.id, code: code.trim() });
      if (result.error) throw result.error;
    } catch {
      setError('The code could not be verified. Enter the latest code from your authenticator.');
    } finally {
      setBusy(false);
    }
  }

  return <>
    <p><ShieldCheck size={18} className="mr-1 inline" aria-hidden="true" /> Open your authenticator app to complete sign-in.</p>
    {loading ? <p role="status">Loading authenticator…</p> : factor ? <>
      {factor.qr && <>
        <p>Scan this QR code in your authenticator app, then enter the six-digit code.</p>
        <img className="rounded-xl border border-border" src={factor.qr} alt="Authenticator enrolment QR code" width={170} height={170} />
        <details><summary>Enter the setup key manually</summary><code className="break-all">{factor.secret}</code></details>
      </>}
      <form onSubmit={verify} className="space-y-3">
        <Input label="Authenticator code" required inputMode="numeric" autoComplete="one-time-code" maxLength={6} pattern="[0-9]{6}" value={code} onChange={e => setCode(e.target.value)} />
        <Button type="submit" isLoading={busy}>Verify code</Button>
      </form>
    </> : <Button onClick={() => void enroll()} isLoading={busy}>Set up authenticator</Button>}
    {error && <p role="alert" className="text-sm text-rose-700">{error}</p>}
    <Button variant="ghost" onClick={onSignOut}>Sign out</Button>
  </>;
}
