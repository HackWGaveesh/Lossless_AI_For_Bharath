import React, { type ErrorInfo, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import Button from './Button';
import { useLanguage } from '../../contexts/LanguageContext';

interface Props {
  children: ReactNode;
  onError?: (error: Error, errorInfo: ErrorInfo) => void;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

function ErrorFallback() {
  const { t } = useLanguage();
  return (
    <div className="min-h-screen bg-surface-bg flex flex-col items-center justify-center p-6 text-center">
      <div className="max-w-md">
        <div className="text-4xl font-display font-bold text-primary-500 mb-2">VaaniSetu</div>
        <h1 className="font-display text-2xl font-semibold text-text-primary mt-6">
          {t('error.title')}
        </h1>
        <p className="font-sans text-text-secondary mt-2">
          {t('error.subtitle')}
        </p>
        <div className="mt-8 flex flex-col sm:flex-row gap-3 justify-center">
          <Button onClick={() => window.location.reload()}>{t('error.refresh')}</Button>
          <Link to="/dashboard">
            <Button variant="outline">{t('error.go_dashboard')}</Button>
          </Link>
        </div>
      </div>
    </div>
  );
}

export default class ErrorBoundary extends React.Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    if (import.meta.env.DEV) {
      console.error('ErrorBoundary caught:', error, errorInfo);
    }
    this.props.onError?.(error, errorInfo);
  }

  render() {
    if (this.state.hasError) {
      return <ErrorFallback />;
    }
    return this.props.children;
  }
}
