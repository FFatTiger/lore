'use client';

import React, { useState, useCallback, FormEvent, ChangeEvent } from 'react';
import { getDomains } from '../lib/api';
import { useT } from '../lib/i18n';
import { AxiosError } from 'axios';

interface TokenAuthProps {
  onAuthenticated: () => void;
}

const TokenAuth = ({ onAuthenticated }: TokenAuthProps): React.JSX.Element => {
  const { t } = useT();
  const [token, setToken] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const handleSubmit = useCallback(async (e: FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    const trimmed = token.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    document.cookie = `api_token=${encodeURIComponent(trimmed)}; path=/; max-age=${60 * 60 * 24 * 30}; SameSite=Lax`;
    try {
      await getDomains();
      onAuthenticated();
    } catch (err) {
      document.cookie = 'api_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
      const axiosErr = err as AxiosError;
      setError(axiosErr.response?.status === 401 ? t('Invalid token') : t('Connection failed'));
    } finally {
      setLoading(false);
    }
  }, [token, onAuthenticated, t]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-bg-system px-6">
      <div className="w-full max-w-[380px] animate-in">
        <div className="mb-10 flex flex-col items-center text-center">
          <div className="mb-5 flex h-14 w-14 items-center justify-center rounded-[18px] bg-gradient-to-br from-sys-blue to-sys-indigo shadow-lg shadow-sys-blue/20">
            <svg width="28" height="28" viewBox="0 0 28 28" fill="none" className="text-white">
              <circle cx="14" cy="14" r="10" stroke="currentColor" strokeWidth="2" />
              <circle cx="19" cy="10" r="3" fill="currentColor" />
            </svg>
          </div>
          <h1 className="text-[28px] font-bold tracking-[-0.02em] text-txt-primary">Lore</h1>
          <p className="mt-1.5 text-[15px] text-txt-secondary">{t('Memory management console')}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div className="rounded-2xl border border-separator-thin bg-bg-elevated p-5 space-y-4">
            <label className="block">
              <span className="mb-2 block text-[13px] font-medium text-txt-secondary">{t('API Token')}</span>
              <input
                type="password"
                value={token}
                onChange={(e: ChangeEvent<HTMLInputElement>) => { setToken(e.target.value); if (error) setError(''); }}
                placeholder={t('Enter your token')}
                disabled={loading}
                autoFocus
                className="w-full rounded-xl border border-separator-thin bg-bg-raised px-4 py-3 text-[15px] text-txt-primary placeholder:text-txt-quaternary focus:border-sys-blue/60 focus:outline-none transition-colors"
              />
            </label>

            {error && (
              <div className="rounded-xl bg-sys-red/10 border border-sys-red/20 px-3.5 py-2.5 text-[13px] text-sys-red">
                {error}
              </div>
            )}

            <button
              type="submit"
              disabled={loading || !token.trim()}
              className="press w-full h-11 rounded-full bg-sys-blue text-[15px] font-medium text-white hover:bg-[#1E90FF] disabled:bg-fill-primary disabled:text-txt-quaternary disabled:cursor-not-allowed transition-colors"
            >
              {loading ? t('Connecting…') : t('Continue')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default TokenAuth;
