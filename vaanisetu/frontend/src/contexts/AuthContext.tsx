import React, { createContext, useContext, useState, useEffect, useCallback, type ReactNode } from 'react';
import {
  signIn,
  confirmSignIn,
  signOut,
  getCurrentUser,
  fetchAuthSession,
  type AuthUser,
} from 'aws-amplify/auth';

const DEV_USER_KEY = 'vaanisetu_dev_user';

let apiUserId: string | null = null;

export function setApiUserId(id: string | null) {
  apiUserId = id;
}

export function getApiUserId(): string | null {
  return apiUserId;
}

/** Set by AuthProvider so api interceptor can get the token without React context */
let getAuthTokenFn: (() => Promise<string | null>) | null = null;

export function setAuthTokenGetter(fn: () => Promise<string | null>) {
  getAuthTokenFn = fn;
}

export function getAuthTokenForApi(): Promise<string | null> {
  return getAuthTokenFn ? getAuthTokenFn() : Promise.resolve(null);
}

export interface User {
  id: string;
  name: string;
  email?: string;
  phone?: string;
}

interface AuthContextType {
  user: User | null;
  userId: string | null;
  isLoading: boolean;
  isAuthenticated: boolean;
  sendOtp: (phoneNumber: string) => Promise<void>;
  verifyOtp: (otp: string) => Promise<void>;
  logout: () => Promise<void>;
  getAuthToken: () => Promise<string | null>;
  devLogin: () => void;
  /** For backward compatibility where code expects login(user) */
  login: (user: User) => void;
  setApiUserId: (id: string | null) => void;
}

const AuthContext = createContext<AuthContextType | null>(null);

function normalizePhone(value: unknown): string | undefined {
  const raw = typeof value === 'string' ? value.trim() : '';
  if (!raw) return undefined;
  if (/^[0-9a-f-]{30,}$/i.test(raw)) return undefined;
  const digits = raw.replace(/\D/g, '');
  if (digits.length < 10 || digits.length > 13) return undefined;
  return digits.length === 10 ? `+91${digits}` : `+${digits}`;
}

function authUserToUser(a: AuthUser, claims?: Record<string, unknown>): User {
  const claimName = typeof claims?.name === 'string' ? claims.name.trim() : '';
  const claimPhone = normalizePhone(claims?.phone_number);
  const username = (a as unknown as { username?: string }).username;
  const phoneFromUsername = username && /^\+?\d{10,13}$/.test(username.replace(/\D/g, '')) ? normalizePhone(username) : undefined;
  const phone = claimPhone ?? phoneFromUsername;
  const claimEmail = typeof claims?.email === 'string' ? claims.email : undefined;
  const fallbackName = username ?? 'User';
  return {
    id: a.userId ?? username ?? '',
    name: claimName || fallbackName,
    email: claimEmail,
    phone,
  };
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [userId, setUserId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);

  useEffect(() => {
    apiUserId = userId;
  }, [userId]);

  const getAuthToken = useCallback(async (): Promise<string | null> => {
    try {
      if (typeof localStorage !== 'undefined' && localStorage.getItem(DEV_USER_KEY) && import.meta.env.DEV) {
        return 'dev-token';
      }
      const session = await fetchAuthSession();
      return session.tokens?.idToken?.toString() ?? null;
    } catch {
      return null;
    }
  }, []);

  useEffect(() => {
    setAuthTokenGetter(getAuthToken);
  }, [getAuthToken]);

  useEffect(() => {
    checkSession();
  }, []);

  async function checkSession() {
    try {
      const devRaw = typeof localStorage !== 'undefined' ? localStorage.getItem(DEV_USER_KEY) : null;
      if (devRaw && import.meta.env.DEV) {
        const parsed = JSON.parse(devRaw) as { userId: string };
        setUserId(parsed.userId);
        setUser({ id: parsed.userId, name: 'Dev User', phone: undefined });
        setIsLoading(false);
        return;
      }

      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();
      const claims = (session.tokens?.idToken?.payload ?? {}) as Record<string, unknown>;
      const nextUser = authUserToUser(currentUser, claims);
      setUser(nextUser);
      setUserId((nextUser.phone ?? nextUser.id) || null);
    } catch {
      setUser(null);
      setUserId(null);
    } finally {
      setIsLoading(false);
    }
  }

  const sendOtp = useCallback(async (phoneNumber: string) => {
    if (!import.meta.env.VITE_USER_POOL_ID) {
      throw new Error('Cognito not configured. Use Dev login for demo.');
    }
    const normalized = phoneNumber.startsWith('+') ? phoneNumber : `+91${phoneNumber.replace(/\D/g, '').slice(-10)}`;
    try {
      await signIn({
        username: normalized,
        options: { authFlowType: 'CUSTOM_WITHOUT_SRP' },
      });
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err ?? '');
      if (/already a signed in user/i.test(message)) {
        await signOut();
        await signIn({
          username: normalized,
          options: { authFlowType: 'CUSTOM_WITHOUT_SRP' },
        });
        return;
      }
      throw err;
    }
  }, []);

  const verifyOtp = useCallback(async (otp: string) => {
    const result = await confirmSignIn({ challengeResponse: otp });
    if (result.isSignedIn) {
      const currentUser = await getCurrentUser();
      const session = await fetchAuthSession();
      const claims = (session.tokens?.idToken?.payload ?? {}) as Record<string, unknown>;
      const nextUser = authUserToUser(currentUser, claims);
      setUser(nextUser);
      setUserId((nextUser.phone ?? nextUser.id) || null);
    }
  }, []);

  const logout = useCallback(async () => {
    try {
      if (typeof localStorage !== 'undefined') localStorage.removeItem(DEV_USER_KEY);
      await signOut();
    } catch {}
    setUser(null);
    setUserId(null);
    apiUserId = null;
  }, []);

  const devLogin = useCallback(() => {
    if (!import.meta.env.DEV) return;
    const devUserId = 'dev-user-001';
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(DEV_USER_KEY, JSON.stringify({ userId: devUserId }));
    }
    setUserId(devUserId);
    setUser({ id: devUserId, name: 'Dev User', phone: undefined });
  }, []);

  const login = useCallback((u: User) => {
    setUser(u);
    const apiId = u.phone ?? u.id;
    setUserId(apiId);
    apiUserId = apiId;
    if (import.meta.env.DEV && typeof localStorage !== 'undefined') {
      localStorage.setItem(DEV_USER_KEY, JSON.stringify({ userId: apiId }));
    }
  }, []);

  const setApiUserIdFn = useCallback((id: string | null) => {
    setApiUserId(id);
    if (id) setUserId(id);
  }, []);

  return (
    <AuthContext.Provider
      value={{
        user,
        userId,
        isLoading,
        isAuthenticated: !!user,
        sendOtp,
        verifyOtp,
        logout,
        getAuthToken,
        devLogin,
        login,
        setApiUserId: setApiUserIdFn,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}
