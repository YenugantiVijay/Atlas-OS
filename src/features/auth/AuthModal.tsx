import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Mail,
  Lock,
  User as UserIcon,
  Eye,
  EyeOff,
  Sparkles,
  AlertCircle,
  CheckCircle2,
  ArrowRight,
} from 'lucide-react';
import { useOrg } from '@/features/organizations/OrgContext';
import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { Modal } from '@/components/ui/Modal';
import { useToast } from '@/components/ui/Toast';
import { EmailCodeInput } from './EmailCodeInput';

export interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  initialMode?: 'signin' | 'signup';
}

export const AuthModal: React.FC<AuthModalProps> = ({
  isOpen,
  onClose,
  initialMode = 'signin',
}) => {
  const { signIn, signUp, sendEmailCode, verifyEmailCode, enterDemoMode } = useOrg();
  const { showToast } = useToast();
  const navigate = useNavigate();

  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);
  const [useCode, setUseCode] = useState(false);
  const [pending, setPending] = useState<{ email: string; purpose: 'signin' | 'signup' } | null>(null);
  const [code, setCode] = useState('');
  const [resendUntil, setResendUntil] = useState(0);
  const [clock, setClock] = useState(0);
  const passwordRequired = mode === 'signup' || !useCode;
  const resendSeconds = Math.max(0, Math.ceil((resendUntil - clock) / 1000));

  useEffect(() => {
    if (!pending || !resendUntil) return;
    const interval = window.setInterval(() => {
      const now = Date.now();
      setClock(now);
      if (now >= resendUntil) window.clearInterval(interval);
    }, 1000);
    return () => window.clearInterval(interval);
  }, [pending, resendUntil]);

  const startCooldown = () => {
    const now = Date.now();
    setClock(now);
    setResendUntil(now + 60000);
  };
  const openCode = (address: string, purpose: 'signin' | 'signup', codeRequested = true) => {
    setPassword('');
    setCode('');
    setPending({ email: address, purpose });
    if (codeRequested) startCooldown();
    else setResendUntil(0);
  };
  const resetCode = () => {
    setPending(null);
    setCode('');
    setErrorMessage(null);
    setSuccessMessage(null);
  };
  const close = () => {
    if (isSubmitting) return;
    resetCode();
    setPassword('');
    onClose();
  };

  const resend = async () => {
    if (!pending || resendSeconds || isSubmitting) return;
    setIsSubmitting(true);
    setErrorMessage(null);
    setSuccessMessage(null);
    try {
      const response = await sendEmailCode(pending.email, pending.purpose);
      if (response.error) setErrorMessage(response.error);
      else {
        setCode('');
        startCooldown();
        setSuccessMessage('Check your inbox for a fresh code.');
      }
    } catch {
      setErrorMessage('The email code could not be requested. Try again.');
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (isSubmitting) return;
    setErrorMessage(null);
    setSuccessMessage(null);

    const address = email.trim().toLowerCase();
    if (!pending && (!address || (passwordRequired && !password))) {
      setErrorMessage(passwordRequired ? 'Enter your email address and password.' : 'Enter your email address.');
      return;
    }

    if (!pending && mode === 'signup' && !fullName.trim()) {
      setErrorMessage('Please enter your full name for your Atlas OS profile.');
      return;
    }

    if (!pending && passwordRequired && password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (pending) {
        if (code.length !== 6) return;
        const res = await verifyEmailCode(pending.email, code);
        if (res.error) setErrorMessage(res.error);
        else {
          const signup = pending.purpose === 'signup';
          showToast('success', signup ? 'Email Verified' : 'Signed In', signup ? 'Your Atlas OS account is ready.' : 'Welcome back to Atlas OS.');
          resetCode();
          onClose();
          if (signup) navigate('/onboarding');
        }
      } else if (mode === 'signin' && useCode) {
        const res = await sendEmailCode(address, 'signin');
        if (res.error) setErrorMessage(res.error);
        else openCode(address, 'signin');
      } else if (mode === 'signin') {
        const res = await signIn(address, password);
        if (res.needsVerification) {
          openCode(address, 'signup', false);
        } else if (res.error) {
          setErrorMessage(res.error);
        } else {
          showToast('success', 'Signed In', `Welcome back, ${email.trim()}`);
          onClose();
        }
      } else {
        const res = await signUp(address, password, fullName.trim());
        if (res.error) {
          setErrorMessage(res.error);
        } else if (res.sessionPresent) {
          showToast('success', 'Account Created', `Welcome to Atlas OS, ${fullName.trim()}`);
          onClose();
          navigate('/onboarding');
        } else {
          openCode(address, 'signup');
        }
      }
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      setErrorMessage(msg);
    } finally {
      setIsSubmitting(false);
    }
  };

  const handleDemoMode = () => {
    enterDemoMode();
    showToast('info', 'Demo Sandbox Active', 'Exploring with offline sample business data.');
    onClose();
  };

  return (
    <Modal
      isOpen={isOpen}
      onClose={close}
      title={pending ? 'Check your email' : mode === 'signin' ? 'Sign In to Atlas OS' : 'Create Atlas OS Account'}
      description={
        pending ? pending.purpose === 'signin'
          ? `If ${pending.email} has an Atlas OS account, a six-digit code will arrive in its inbox.`
          : `Enter the six-digit code for ${pending.email}. Request a new code if needed.`
          : mode === 'signin' ? 'Sign in with your password or an email code.' : 'Verify your email to set up your workspace.'
      }
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Mode Tabs */}
        {!pending && <div className="flex p-1 bg-surface-panel rounded-xl border border-border">
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setMode('signin');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              mode === 'signin'
                ? 'bg-surface-card text-content-primary shadow-xs border border-border'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            Sign In
          </button>
          <button
            type="button"
            disabled={isSubmitting}
            onClick={() => {
              setMode('signup');
              setErrorMessage(null);
              setSuccessMessage(null);
            }}
            className={`flex-1 py-2 text-xs font-semibold rounded-lg transition-all ${
              mode === 'signup'
                ? 'bg-surface-card text-content-primary shadow-xs border border-border'
                : 'text-content-secondary hover:text-content-primary'
            }`}
          >
            Create Account
          </button>
        </div>}

        {/* Error Alert */}
        {errorMessage && (
          <div role="alert" className="p-3.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block">Authentication Error</span>
              {errorMessage}
            </div>
          </div>
        )}

        {/* Success Alert */}
        {successMessage && (
          <div role="status" className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs flex items-start gap-2.5 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block">Success</span>
              {successMessage}
            </div>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {pending ? <>
            <EmailCodeInput value={code} onChange={setCode} disabled={isSubmitting} />
            <Button type="submit" className="w-full" disabled={code.length !== 6} isLoading={isSubmitting}>Verify code</Button>
            <div className="flex flex-wrap items-center justify-between gap-2">
              <Button type="button" variant="ghost" size="sm" disabled={isSubmitting} onClick={resetCode}>Change email</Button>
              <Button type="button" variant="ghost" size="sm" disabled={isSubmitting || resendSeconds > 0} onClick={() => void resend()}>
                {resendSeconds ? `Resend in ${resendSeconds}s` : 'Resend code'}
              </Button>
            </div>
          </> : <>
          {mode === 'signup' && (
            <Input
              label="Full Name"
              required
              disabled={isSubmitting}
              autoComplete="name"
              value={fullName}
              onChange={(e) => setFullName(e.target.value)}
              placeholder="Enter your full name"
              leftIcon={<UserIcon className="w-4 h-4" />}
            />
          )}

          <Input
            label="Email Address"
            type="email"
            required
            disabled={isSubmitting}
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. owner@enterprise.com"
            leftIcon={<Mail className="w-4 h-4" />}
          />

          {passwordRequired && <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              required
              disabled={isSubmitting}
              autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              leftIcon={<Lock className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  disabled={isSubmitting}
                  tabIndex={-1}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="hover:text-content-primary transition-colors focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
          </div>}

          <Button
            type="submit"
            variant="primary"
            className="w-full py-2.5 mt-2"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            {mode === 'signup' ? 'Create Verified Account' : useCode ? 'Send sign-in code' : 'Sign In to Live Cloud'}
          </Button>
          {mode === 'signin' && <Button type="button" variant="ghost" size="sm" className="w-full" disabled={isSubmitting}
            onClick={() => { setUseCode(!useCode); setPassword(''); setErrorMessage(null); }}>
            {useCode ? 'Use password' : 'Sign in with an email code'}
          </Button>}
          </>}
        </form>

        {/* Divider */}
        {!pending && <><div className="relative flex items-center justify-center my-4">
          <div className="border-t border-border w-full" />
          <span className="bg-surface-card px-3 text-[11px] font-medium text-content-muted uppercase tracking-wider absolute">
            Or
          </span>
        </div>

        {/* Demo Mode Action */}
        <div className="p-3.5 rounded-xl bg-surface-panel border border-border flex items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-content-primary flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-atlas-600" />
              Offline Demo Sandbox
            </div>
            <div className="text-[11px] text-content-muted truncate">
              Explore ERP workflows with local sample data without signing in
            </div>
          </div>
          <Button type="button" variant="outline" size="sm" disabled={isSubmitting} onClick={handleDemoMode}>
            Explore Demo
          </Button>
        </div></>}
      </div>
    </Modal>
  );
};
