import { createContext, useContext, useState, useEffect } from 'react';
import { api } from './api';

const AuthContext = createContext(null);

export function AuthProvider({ children }) {
  const [user, setUser] = useState(undefined); // undefined = loading

  useEffect(() => {
    api.get('/auth/me')
      .then(setUser)
      .catch(() => setUser(null));
  }, []);

  async function login(username, password) {
    await api.post('/auth/login', { username, password });
    const u = await api.get('/auth/me');
    setUser(u);
  }

  async function signup(username, password) {
    await api.post('/auth/signup', { username, password });
    const u = await api.get('/auth/me');
    setUser(u);
  }

  async function logout() {
    await api.post('/auth/logout', {});
    setUser(null);
  }

  return (
    <AuthContext.Provider value={{ user, login, signup, logout }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}
