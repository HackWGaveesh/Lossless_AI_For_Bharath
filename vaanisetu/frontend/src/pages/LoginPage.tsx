import { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../contexts/AuthContext';
import Button from '../components/Common/Button';
import Input from '../components/Common/Input';
import LanguageSwitcher from '../components/Common/LanguageSwitcher';
import { useLanguage } from '../contexts/LanguageContext';

export default function LoginPage() {
  const navigate = useNavigate();
  const { sendOtp, verifyOtp, devLogin, isAuthenticated } = useAuth();
  const { t } = useLanguage();
  const [step, setStep] = useState<'phone' | 'otp'>('phone');
  const [phone, setPhone] = useState('');
  const [otp, setOtp] = useState(['', '', '', '', '', '']);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [resendTimer, setResendTimer] = useState(0);
  const [showDevBypassForError, setShowDevBypassForError] = useState(false);
  const showDevBypass = import.meta.env.DEV || !import.meta.env.VITE_USER_POOL_ID || showDevBypassForError;
  const resendIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const startResendTimer = (seconds: number) => {
    setResendTimer(seconds);
    if (resendIntervalRef.current) clearInterval(resendIntervalRef.current);
    resendIntervalRef.current = setInterval(() => {
      setResendTimer((prev) => {
        if (prev <= 1) {
          if (resendIntervalRef.current) {
            clearInterval(resendIntervalRef.current);
            resendIntervalRef.current = null;
          }
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  };

  useEffect(() => {
    return () => {
      if (resendIntervalRef.current) clearInterval(resendIntervalRef.current);
    };
  }, []);

  const handleSendOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) {
      setError(t('auth.phone_error'));
      return;
    }
    setLoading(true);
    try {
      await sendOtp('+91' + digits);
      setStep('otp');
      startResendTimer(120);
    } catch (err: unknown) {
      const errAny = err as { name?: string; message?: string } | null;
      if (!import.meta.env.VITE_USER_POOL_ID) {
        setError('Cognito not configured. Use the Dev bypass below.');
        return;
      }
      const raw = errAny?.message ?? (err instanceof Error ? err.message : String(err ?? t('auth.otp_error')));
      const isCustomAuthNotConfigured = errAny?.message?.includes('Custom auth lambda trigger');
      const message =
        errAny?.name === 'UserNotFoundException'
          ? t('auth.phone_not_registered')
          : isCustomAuthNotConfigured
            ? 'Auth service not fully configured. Use the Dev login button below to continue.'
            : /password|signin|required/i.test(raw)
              ? t('auth.send_otp_error')
              : raw;
      setError(message);
      if (isCustomAuthNotConfigured) setShowDevBypassForError(true);
    } finally {
      setLoading(false);
    }
  };

  const handleResendOTP = async () => {
    if (resendTimer > 0 || loading) return;
    setError('');
    const digits = phone.replace(/\D/g, '').slice(-10);
    if (digits.length !== 10) {
      setError(t('auth.phone_error'));
      setStep('phone');
      return;
    }
    setLoading(true);
    try {
      await sendOtp('+91' + digits);
      startResendTimer(120);
    } catch (err: unknown) {
      const raw = err instanceof Error ? err.message : String(err ?? t('auth.send_otp_error'));
      setError(raw || t('auth.send_otp_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleVerifyOTP = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    const code = otp.join('');
    if (code.length !== 6) {
      setError(t('auth.otp_error'));
      return;
    }
    setLoading(true);
    try {
      await verifyOtp(code);
      navigate('/dashboard');
    } catch {
      setError(t('auth.otp_error'));
    } finally {
      setLoading(false);
    }
  };

  const handleDevSkip = () => {
    devLogin();
    navigate('/dashboard');
  };

  return (
    <div className="min-h-screen flex">
      <div className="hidden lg:flex lg:w-2/5 bg-gradient-to-br from-primary-500 to-secondary-500 relative overflow-hidden">
        <div className="absolute inset-0 opacity-20">
          <svg className="w-full h-full" viewBox="0 0 100 100" preserveAspectRatio="none">
            {[1, 2, 3, 4, 5].map((i) => (
              <circle key={i} cx={50} cy={50} r={10 + i * 15} fill="none" stroke="white" strokeWidth="0.5" />
            ))}
          </svg>
        </div>
        <div className="relative z-10 flex flex-col justify-center px-12 text-white">
          <p className="font-display text-3xl italic font-light">One call.</p>
          <p className="font-display text-3xl italic font-light">Any language.</p>
          <p className="font-display text-3xl font-semibold">Every scheme.</p>
          <p className="mt-6 text-white/90 text-lg font-sans">VaaniSetu — {t('auth.login_subtitle')}</p>
        </div>
      </div>

      <div className="flex-1 flex items-center justify-center p-8 bg-surface-bg">
        <div className="w-full max-w-md">
          <div className="flex justify-between items-center mb-8">
            <span className="font-display text-2xl font-semibold text-text-primary">
              वाणी<span className="font-sans font-medium">Setu</span>
            </span>
            <LanguageSwitcher />
          </div>

          {step === 'phone' ? (
            <form onSubmit={handleSendOTP} className="space-y-6">
              <h1 className="font-display text-2xl font-semibold text-text-primary">
                {t('auth.login_title')}
              </h1>
              <p className="text-text-secondary text-sm">{t('auth.phone_placeholder')}</p>
              <p className="text-text-muted text-xs mt-1">New user? Same screen — enter your number and we’ll send an OTP.</p>
              <Input
                label={t('auth.phone_label')}
                type="tel"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                maxLength={14}
                placeholder="9876543210"
              />
              {error && <p className="text-red-700 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('common.loading') : t('auth.send_otp')}
              </Button>
            </form>
          ) : (
            <form onSubmit={handleVerifyOTP} className="space-y-6">
              <h1 className="font-display text-2xl font-semibold text-text-primary">{t('auth.verify_otp')}</h1>
              <p className="text-text-secondary text-sm">{t('auth.otp_sent')} +91 ******{phone.slice(-4)}</p>
              <div className="flex gap-2 justify-center">
                {otp.map((digit, i) => (
                  <input
                    key={i}
                    type="text"
                    inputMode="numeric"
                    maxLength={1}
                    value={digit}
                    onChange={(e) => {
                      const v = e.target.value.replace(/\D/g, '').slice(0, 1);
                      setOtp((prev) => {
                        const next = [...prev];
                        next[i] = v;
                        if (v && i < 5) (document.querySelector(`input[name=otp-${i + 1}]`) as HTMLInputElement)?.focus();
                        return next;
                      });
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Backspace' && !otp[i] && i > 0) {
                        (document.querySelector(`input[name=otp-${i - 1}]`) as HTMLInputElement)?.focus();
                      }
                    }}
                    name={`otp-${i}`}
                    className="w-12 h-12 text-center text-lg font-semibold border border-surface-border rounded-lg focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20"
                  />
                ))}
              </div>
              {resendTimer > 0 ? (
                <p className="text-text-muted text-sm text-center">{t('auth.resend_otp')} {resendTimer}s</p>
              ) : (
                <button type="button" className="text-primary-500 text-sm w-full text-center" onClick={handleResendOTP}>
                  {t('auth.resend_otp')}
                </button>
              )}
              {error && <p className="text-red-700 text-sm">{error}</p>}
              <Button type="submit" className="w-full" disabled={loading}>
                {loading ? t('common.loading') : t('auth.verify_otp')}
              </Button>
            </form>
          )}

          {showDevBypass && (
            <div className="mt-8 pt-6 border-t border-surface-border">
              <button
                type="button"
                onClick={handleDevSkip}
                className="w-full py-2 text-sm text-text-muted hover:text-primary-500"
              >
                {t('auth.dev_skip')}
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
