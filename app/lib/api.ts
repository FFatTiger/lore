'use client';

import axios, { AxiosInstance, InternalAxiosRequestConfig, AxiosResponse, AxiosError } from 'axios';

export const AUTH_ERROR_EVENT = 'lore:auth-error';

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

export default api;
