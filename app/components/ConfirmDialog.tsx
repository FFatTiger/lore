'use client';

import React, { useCallback, useContext, useMemo, useRef, useState, createContext, ReactNode } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { Toaster, toast as sonnerToast } from 'sonner';
import clsx from 'clsx';
import { Button } from './ui';
import { useTheme } from '../lib/theme';

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

function ConfirmModal({ dialog, onConfirm, onCancel }: { dialog: DialogState; onConfirm: () => void; onCancel: () => void }): React.JSX.Element {
  return (
    <Dialog.Root open onOpenChange={(open) => { if (!open) onCancel(); }}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-[90] bg-black/50 backdrop-blur-sm animate-in" />
        <Dialog.Content
          className="animate-in fixed left-1/2 top-1/2 z-[91] w-[calc(100vw-2rem)] max-w-[400px] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-separator-thin bg-bg-elevated p-6 shadow-xl outline-none"
          onEscapeKeyDown={onCancel}
          onPointerDownOutside={onCancel}
        >
          {dialog.title ? (
            <Dialog.Title className="mb-2 text-[17px] font-semibold tracking-tight text-txt-primary">
              {dialog.title}
            </Dialog.Title>
          ) : null}
          <Dialog.Description className="mb-6 text-[14px] leading-relaxed text-txt-secondary">
            {dialog.message}
          </Dialog.Description>
          <div className="flex justify-end gap-2">
            <Dialog.Close asChild>
              <Button variant="ghost" size="sm" onClick={onCancel}>
                {dialog.cancelLabel || 'Cancel'}
              </Button>
            </Dialog.Close>
            <Button
              variant={dialog.destructive ? 'destructive' : 'primary'}
              size="sm"
              onClick={onConfirm}
              autoFocus
            >
              {dialog.confirmLabel || 'Confirm'}
            </Button>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}

export function ConfirmProvider({ children }: { children: ReactNode }): React.JSX.Element {
  const { theme } = useTheme();
  const [dialog, setDialog] = useState<DialogState | null>(null);
  const dialogRef = useRef<DialogState | null>(null);

  const confirmFn = useCallback((options: ConfirmOptions): Promise<boolean> => {
    return new Promise((resolve) => {
      const nextDialog = { ...options, resolve };
      dialogRef.current = nextDialog;
      setDialog(nextDialog);
    });
  }, []);

  const dismissDialog = useCallback((value: boolean) => {
    const current = dialogRef.current;
    if (!current) return;
    dialogRef.current = null;
    setDialog(null);
    current.resolve(value);
  }, []);

  const handleConfirm = useCallback(() => dismissDialog(true), [dismissDialog]);
  const handleCancel = useCallback(() => dismissDialog(false), [dismissDialog]);

  const toastFn = useCallback((message: string, type: 'success' | 'error' = 'error') => {
    const method = type === 'success' ? sonnerToast.success : sonnerToast.error;
    method(message, {
      duration: 4000,
      classNames: {
        toast: clsx(
          'rounded-xl border px-4 py-3 text-[13px] shadow-lg backdrop-blur-xl',
          type === 'success'
            ? 'border-sys-green/20 bg-sys-green/10 text-sys-green'
            : 'border-sys-red/20 bg-sys-red/10 text-sys-red',
        ),
        title: 'text-inherit font-medium',
      },
    });
  }, []);

  const contextValue = useMemo(() => ({ confirm: confirmFn, toast: toastFn }), [confirmFn, toastFn]);

  return (
    <ConfirmContext.Provider value={contextValue}>
      {children}
      <Toaster
        position="bottom-right"
        theme={theme === 'light' ? 'light' : 'dark'}
        visibleToasts={4}
        expand={false}
        richColors={false}
        closeButton={false}
        toastOptions={{
          unstyled: true,
        }}
      />
      {dialog ? <ConfirmModal dialog={dialog} onConfirm={handleConfirm} onCancel={handleCancel} /> : null}
    </ConfirmContext.Provider>
  );
}
