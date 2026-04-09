'use client';

import React, { useState, useCallback, createContext, useContext, ReactNode } from 'react';
import { Button } from './ui';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
}

interface ConfirmContextValue {
  confirm: (options: ConfirmOptions) => Promise<boolean>;
  toast: (message: string, type?: 'success' | 'error') => void;
}

const ConfirmContext = createContext<ConfirmContextValue | null>(null);

export function useConfirm(): ConfirmContextValue {
  const ctx = useContext(ConfirmContext);
  if (!ctx) throw new Error('useConfirm must be used within ConfirmProvider');
  return ctx;
}

interface DialogState extends ConfirmOptions {
  resolve: (value: boolean) => void;
}

interface ToastState {
  message: string;
  type: 'success' | 'error';
  id: number;
}

export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const [toasts, setToasts] = useState<ToastState[]>([]);

  const confirmFn = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      setDialog({ ...options, resolve });
    });
  }, []);

  const toastFn = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    const id = Date.now();
    setToasts((prev) => [...prev, { message, type, id }]);
    setTimeout(() => setToasts((prev) => prev.filter((t) => t.id !== id)), 4000);
  }, []);

  const handleConfirm = () => {
    dialog?.resolve(true);
    setDialog(null);
  };

  const handleCancel = () => {
    dialog?.resolve(false);
    setDialog(null);
  };

  return (
    <ConfirmContext.Provider value={{ confirm: confirmFn, toast: toastFn }}>
      {children}

      {/* Toast stack */}
      {toasts.length > 0 && (
        <div className="fixed bottom-4 right-4 z-[100] flex flex-col gap-2 max-w-sm">
          {toasts.map((t) => (
            <div
              key={t.id}
              className={`animate-in rounded-xl border px-4 py-3 text-[13px] shadow-lg backdrop-blur-xl ${
                t.type === 'success'
                  ? 'border-sys-green/20 bg-sys-green/10 text-sys-green'
                  : 'border-sys-red/20 bg-sys-red/10 text-sys-red'
              }`}
            >
              {t.message}
            </div>
          ))}
        </div>
      )}

      {/* Confirm dialog overlay */}
      {dialog && (
        <div className="fixed inset-0 z-[90] flex items-center justify-center bg-black/50 backdrop-blur-sm" onClick={handleCancel}>
          <div
            className="animate-in mx-4 w-full max-w-[400px] rounded-2xl border border-separator-thin bg-bg-elevated p-6 shadow-xl"
            onClick={(e) => e.stopPropagation()}
          >
            {dialog.title && (
              <h3 className="mb-2 text-[17px] font-semibold tracking-tight text-txt-primary">{dialog.title}</h3>
            )}
            <p className="mb-6 text-[14px] leading-relaxed text-txt-secondary">{dialog.message}</p>
            <div className="flex justify-end gap-2">
              <Button variant="ghost" size="sm" onClick={handleCancel}>
                {dialog.cancelLabel || 'Cancel'}
              </Button>
              <Button
                variant={dialog.destructive ? 'destructive' : 'primary'}
                size="sm"
                onClick={handleConfirm}
                autoFocus
              >
                {dialog.confirmLabel || 'Confirm'}
              </Button>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
