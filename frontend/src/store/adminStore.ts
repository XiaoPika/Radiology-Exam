import { create } from 'zustand';

interface AdminState {
  token: string | null;
  isAuthenticated: boolean;
  username: string;
  displayName: string;
  isSuperadmin: boolean;

  setToken: (token: string, username: string, displayName: string, isSuperadmin: boolean) => void;
  logout: () => void;
}

export const useAdminStore = create<AdminState>((set) => ({
  token: localStorage.getItem('admin_token'),
  isAuthenticated: !!localStorage.getItem('admin_token'),
  username: localStorage.getItem('admin_username') || '',
  displayName: localStorage.getItem('admin_display_name') || '',
  isSuperadmin: localStorage.getItem('admin_is_superadmin') === 'true',

  setToken: (token, username, displayName, isSuperadmin) => {
    localStorage.setItem('admin_token', token);
    localStorage.setItem('admin_username', username);
    localStorage.setItem('admin_display_name', displayName);
    localStorage.setItem('admin_is_superadmin', String(isSuperadmin));
    set({ token, isAuthenticated: true, username, displayName, isSuperadmin });
  },

  logout: () => {
    localStorage.removeItem('admin_token');
    localStorage.removeItem('admin_username');
    localStorage.removeItem('admin_display_name');
    localStorage.removeItem('admin_is_superadmin');
    set({ token: null, isAuthenticated: false, username: '', displayName: '', isSuperadmin: false });
  },
}));
