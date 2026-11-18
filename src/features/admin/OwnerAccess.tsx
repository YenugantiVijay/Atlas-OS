import { useEffect, useState } from 'react';
import type { Session, SupabaseClient } from '@supabase/supabase-js';
import { useQueryClient } from '@tanstack/react-query';
import { Eye, EyeOff } from 'lucide-react';
import { ownerSupabase as supabase } from '@/lib/owner-supabase';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { OwnerConsole } from './OwnerConsole';
import { AuthenticatorChallenge } from '@/features/auth/AuthenticatorChallenge';
import { requestSignInCode } from '@/features/auth/email-sign-in';

type Access = 'loading' | 'signed-out' | 'blocked' | 'mfa' | 'ready' | 'error';

export function OwnerAccess() {
  const cache = useQueryClient();
  const [session, setSession] = useState<Session | null>(null);
  const [access, setAccess] = useState<Access>('loading');

  useEffect(() => {
    if (!supabase) return;
    let active = true;
    let sequence = 0;
    let currentAccount: string | undefined;
    const check = async (next: Session | null) => {
      if (!active) return;
      const pending = ++sequence;
      if (currentAccount !== next?.user.id) {
        cache.clear();
        setAccess(next ? 'loading' : 'signed-out');
      }
      currentAccount = next?.user.id;
      setSession(next);
      if (!next) { setAccess('signed-out'); return; }
      const [allowed, assurance] = await Promise.all([
        supabase!.rpc('owner_console_gate'),
        supabase!.auth.mfa.getAuthenticatorAssuranceLevel(),
      ]);
      if (!active || pending !== sequence) return;
      if (allowed.error || assurance.error) setAccess('error');
      else if (allowed.data !== true) setAccess('blocked');
      else setAccess(assurance.data.currentLevel === 'aal2' ? 'ready' : 'mfa');
    };
    // Supabase auth callbacks must return before issuing any auth requests.
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      window.setTimeout(() => { void check(next); }, 0);
    });
    const recheck = () => { void supabase!.auth.getSession().then(({ data }) => check(data.session)); };
    window.addEventListener('focus', recheck);
    const timer = window.setInterval(recheck, 30_000);
    return () => { active = false; subscription.unsubscribe(); window.removeEventListener('focus', recheck); window.clearInterval(timer); };
  }, [cache]);

  if (!supabase) return <PrivateScreen title="Private Console"><p>Connect this ERP build to Supabase to continue.</p></PrivateScreen>;
  if (access === 'ready' && session) {
    return <OwnerConsole key={session.user.id} account={session.user.id} onSignOut={() => void supabase!.auth.signOut({ scope: 'local' })} />;
  }
  if (access === 'signed-out') return <OwnerLogin client={supabase} />;
  if (access === 'mfa' && session) return <PrivateScreen title="Verify your authenticator">
    <AuthenticatorChallenge key={session.user.id} client={supabase} name="Atlas Owner Console"
      onSignOut={() => void supabase!.auth.signOut({ scope: 'local' })} />
  </PrivateScreen>;
  return <PrivateScreen title="Private Console">
    {access === 'loading' ? <p role="status">Checking access…</p> : <>
      <p role="alert">{access === 'blocked' ? 'This account is not authorized for the owner console.' : 'Access could not be verified. Reload to try again.'}</p>
      <Button variant="outline" onClick={() => void supabase!.auth.signOut({ scope: 'local' })}>Sign out</Button>
    </>}
  </PrivateScreen>;
}

function PrivateScreen({ title, children }: { title: string; children: React.ReactNode }) {
  return <main className="owner-login">
    <section className="owner-login-card">
      <div className="owner-login-brand">
        <img src="/favicon.svg" width={44} height={44} alt="" />
        <span>Atlas OS</span>
      </div>
      <h1>{title}</h1>
      <div className="space-y-4">{children}</div>
    </section>
  </main>;
}

function OwnerLogin({ client }: { client: SupabaseClient }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [code, setCode] = useState('');
  const [method, setMethod] = useState<'password' | 'email' | 'code'>('password');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  async function submit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setShowPassword(false);
    try {
      if (method === 'password') {
        const result = await client.auth.signInWithPassword({ email: email.trim(), password });
        if (result.error) throw result.error;
      } else if (method === 'email') {
        const result = await requestSignInCode(client, email);
        if (result.error) { setError(result.error); return; }
        setMethod('code');
      } else {
        const result = await client.auth.verifyOtp({ email: email.trim(), token: code.trim(), type: 'email' });
        if (result.error) throw result.error;
      }
    } catch {
      setError('Sign-in could not be completed. Check your details and try again.');
    } finally {
      setBusy(false);
    }
  }
  return <PrivateScreen title="Private Console">
    <p>Sign in with an authorized Atlas owner account.</p>
    <form onSubmit={submit} className="space-y-3">
      <Input label="Email" type="email" autoComplete="username" required value={email} disabled={method === 'code'} onChange={e => setEmail(e.target.value)} />
      {method === 'password' && <Input id="owner-password" label="Password" type={showPassword ? 'text' : 'password'}
        autoComplete="current-password" required value={password} onChange={e => setPassword(e.target.value)}
        className="!pr-12"
        rightIcon={<button type="button" className="owner-password-toggle" aria-controls="owner-password"
          aria-label={showPassword ? 'Hide password' : 'Show password'} disabled={busy}
          onClick={() => setShowPassword(visible => !visible)}>
          {showPassword ? <EyeOff size={18} aria-hidden="true" /> : <Eye size={18} aria-hidden="true" />}
        </button>} />}
      {method === 'code' && <Input label="Email verification code" autoComplete="one-time-code" required inputMode="numeric"
        pattern="[0-9]{6}" maxLength={6} value={code} onChange={e => setCode(e.target.value)}
        helperText="Check your inbox and spam folder. You can request another code below." />}
      {method === 'code' && <Button type="button" variant="outline" disabled={busy} onClick={() => {
        setCode(''); setMethod('email'); setError('');
      }}>Request another code</Button>}
      {error && <p role="alert" className="owner-error">{error}</p>}
      <Button type="submit" isLoading={busy}>{method === 'email' ? 'Send sign-in code' : method === 'code' ? 'Verify email code' : 'Sign in'}</Button>
      <Button type="button" variant="ghost" disabled={busy} onClick={() => { setMethod(method === 'password' ? 'email' : 'password'); setShowPassword(false); setError(''); }}>{method === 'password' ? 'Use email code' : 'Use password'}</Button>
    </form>
  </PrivateScreen>;
}
