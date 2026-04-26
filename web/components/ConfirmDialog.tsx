'use client';

import React, { useCallback, useContext, useMemo, useRef, useState, createContext, ReactNode } from 'react';
import LobeModal from '@lobehub/ui/es/Modal/index';
import { Toaster, toast as sonnerToast } from 'sonner';
import clsx from 'clsx';
import { useTheme } from '../lib/theme';
import { useT } from '../lib/i18n';

interface ConfirmOptions {
  title?: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  destructive?: boolean;
  hideCancel?: boolean;
  dismissible?: boolean;
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

export function ConfirmModalForTest({ dialog, onConfirm, onCancel }: { dialog: DialogState; onConfirm: () => void; onCancel: () => void }): React.JSX.Element {
  const { t } = useT();
  const dismissible = dialog.dismissible !== false;
  return (
    <LobeModal
      cancelButtonProps={dialog.hideCancel ? { style: { display: 'none' } } : undefined}
      cancelText={dialog.cancelLabel || t('Cancel')}
      centered
      className="rounded-2xl border border-separator-thin bg-bg-elevated shadow-xl [&_.ant-modal-content]:rounded-2xl [&_.ant-modal-content]:border [&_.ant-modal-content]:border-separator-thin [&_.ant-modal-content]:bg-bg-elevated [&_.ant-modal-content]:shadow-xl"
      closable={dismissible}
      maskClosable={dismissible}
      okButtonProps={{ danger: Boolean(dialog.destructive) }}
      okText={dialog.confirmLabel || t('Confirm')}
      onCancel={onCancel}
      onOk={onConfirm}
      open
      title={dialog.title}
      width={400}
    >
      <p className="text-[14px] leading-relaxed text-txt-secondary">
        {dialog.message}
      </p>
    </LobeModal>
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
      {dialog ? <ConfirmModalForTest dialog={dialog} onConfirm={handleConfirm} onCancel={handleCancel} /> : null}
    </ConfirmContext.Provider>
  );
}
