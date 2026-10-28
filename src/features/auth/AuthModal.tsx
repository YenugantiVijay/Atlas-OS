import React, { useState } from 'react';
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
  const { signIn, signUp, enterDemoMode } = useOrg();
  const { showToast } = useToast();

  const [mode, setMode] = useState<'signin' | 'signup'>(initialMode);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMessage(null);
    setSuccessMessage(null);

    if (!email.trim() || !password) {
      setErrorMessage('Please enter both email address and password.');
      return;
    }

    if (mode === 'signup' && !fullName.trim()) {
      setErrorMessage('Please enter your full name for your Atlas OS profile.');
      return;
    }

    if (password.length < 6) {
      setErrorMessage('Password must be at least 6 characters long.');
      return;
    }

    setIsSubmitting(true);
    try {
      if (mode === 'signin') {
        const res = await signIn(email.trim(), password);
        if (res.error) {
          setErrorMessage(res.error);
        } else {
          showToast('success', 'Signed In', `Welcome back, ${email.trim()}`);
          onClose();
        }
      } else {
        const res = await signUp(email.trim(), password, fullName.trim());
        if (res.error) {
          setErrorMessage(res.error);
        } else if (res.sessionPresent) {
          showToast('success', 'Account Created', `Welcome to Atlas OS, ${fullName.trim()}`);
          onClose();
        } else {
          setSuccessMessage(
            'Confirmation link sent to your email. Please verify your email to log in.'
          );
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
      onClose={onClose}
      title={mode === 'signin' ? 'Sign In to Atlas OS' : 'Create Atlas OS Account'}
      description={
        mode === 'signin'
          ? 'Authenticate securely with your Supabase credentials to access live cloud data.'
          : 'Register a new authenticated tenant profile on Supabase.'
      }
      maxWidth="md"
    >
      <div className="space-y-5">
        {/* Mode Tabs */}
        <div className="flex p-1 bg-surface-panel rounded-xl border border-border">
          <button
            type="button"
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
        </div>

        {/* Error Alert */}
        {errorMessage && (
          <div className="p-3.5 rounded-xl bg-rose-50 border border-rose-200/80 text-rose-800 text-xs flex items-start gap-2.5 animate-in fade-in">
            <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block">Authentication Error</span>
              {errorMessage}
            </div>
          </div>
        )}

        {/* Success Alert */}
        {successMessage && (
          <div className="p-3.5 rounded-xl bg-emerald-50 border border-emerald-200/80 text-emerald-800 text-xs flex items-start gap-2.5 animate-in fade-in">
            <CheckCircle2 className="w-4 h-4 shrink-0 text-emerald-600 mt-0.5" />
            <div className="leading-relaxed">
              <span className="font-semibold block">Success</span>
              {successMessage}
            </div>
          </div>
        )}

        {/* Auth Form */}
        <form onSubmit={handleSubmit} className="space-y-4">
          {mode === 'signup' && (
            <Input
              label="Full Name"
              required
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
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder="e.g. owner@enterprise.com"
            leftIcon={<Mail className="w-4 h-4" />}
          />

          <div className="relative">
            <Input
              label="Password"
              type={showPassword ? 'text' : 'password'}
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder="••••••••••••"
              leftIcon={<Lock className="w-4 h-4" />}
              rightIcon={
                <button
                  type="button"
                  tabIndex={-1}
                  onClick={() => setShowPassword((prev) => !prev)}
                  className="hover:text-content-primary transition-colors focus:outline-none"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              }
            />
          </div>

          <Button
            type="submit"
            variant="primary"
            className="w-full py-2.5 mt-2"
            isLoading={isSubmitting}
            rightIcon={<ArrowRight className="w-4 h-4" />}
          >
            {mode === 'signin' ? 'Sign In to Live Cloud' : 'Create Verified Account'}
          </Button>
        </form>

        {/* Divider */}
        <div className="relative flex items-center justify-center my-4">
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
          <Button type="button" variant="outline" size="sm" onClick={handleDemoMode}>
            Explore Demo
          </Button>
        </div>
      </div>
    </Modal>
  );
};
