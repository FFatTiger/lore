'use client';

import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';
import type { BootViewData, GenerateBootDraftsResponse, SaveBootNodesResponse } from '@/lib/bootSetup';

export const AUTH_ERROR_EVENT = 'lore:auth-error';
const WEB_CLIENT_TYPE = 'admin';

export const api: AxiosInstance = axios.create({
  baseURL: '/api',
});

// Request interceptor: attach Bearer Token from cookie
api.interceptors.request.use((config: InternalAxiosRequestConfig): InternalAxiosRequestConfig => {
  if (typeof window !== 'undefined') {
    const token = document.cookie
      .split('; ')
      .find((c) => c.startsWith('api_token='))
      ?.split('=')[1];
    if (token) {
      config.headers = config.headers ?? {};
      config.headers.Authorization = `Bearer ${decodeURIComponent(token)}`;
    }
  }

  const url = typeof config.url === 'string' ? config.url : '';
  const shouldAttachClientType = url.startsWith('/browse/') && !url.startsWith('/browse/recall/stats');
  if (shouldAttachClientType && !(config.params && typeof config.params === 'object' && 'client_type' in config.params)) {
    config.params = {
      ...(config.params && typeof config.params === 'object' ? config.params : {}),
      client_type: WEB_CLIENT_TYPE,
    };
  }

  return config;
});

// Response interceptor: 401 → clear cookie + re-auth
api.interceptors.response.use(
  (response: AxiosResponse): AxiosResponse => response,
  (error: AxiosError): Promise<never> => {
    if (error.response?.status === 401) {
      if (typeof window !== 'undefined') {
        document.cookie = 'api_token=; path=/; expires=Thu, 01 Jan 1970 00:00:00 GMT';
        window.dispatchEvent(new CustomEvent(AUTH_ERROR_EVENT));
      }
    }
    return Promise.reject(error);
  }
);

export const getDomains = (): Promise<unknown> => api.get('/browse/domains').then((r) => r.data);
export const getBootStatus = (): Promise<BootViewData> => api.get('/browse/boot').then((r) => r.data as BootViewData);
export const saveBootStatus = (payload: { session_id?: string | null; nodes: Record<string, string> }): Promise<SaveBootNodesResponse> =>
  api.put('/browse/boot', payload).then((r) => r.data as SaveBootNodesResponse);
export const generateBootStatusDrafts = (payload: {
  uris?: string[];
  shared_context?: string;
  node_context?: Record<string, string>;
}): Promise<GenerateBootDraftsResponse> =>
  api.post('/browse/boot/draft', payload).then((r) => r.data as GenerateBootDraftsResponse);

export const getBackupStatus = (): Promise<unknown> => api.get('/backup').then((r) => r.data);
export const listBackups = (): Promise<unknown> => api.get('/backup?action=list').then((r) => r.data);
export const downloadBackup = (filename: string): Promise<unknown> =>
  api.get(`/backup?action=download&filename=${encodeURIComponent(filename)}`).then((r) => r.data);
export const createBackup = (): Promise<unknown> => api.post('/backup', {}).then((r) => r.data);
export const restoreBackup = (data: unknown): Promise<unknown> =>
  api.post('/backup', { action: 'restore', data }).then((r) => r.data);
export const restoreBackupByFilename = (filename: string): Promise<unknown> =>
  api.post('/backup', { action: 'restore-file', filename }).then((r) => r.data);

export default api;
