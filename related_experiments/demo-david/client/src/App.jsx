import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom';
import { AuthProvider, useAuth } from './AuthContext';
import { ThemeProvider } from './ThemeContext';
import Layout from './components/Layout';
import Login from './pages/Login';
import SignUp from './pages/SignUp';
import Dashboard from './pages/Dashboard';
import Transactions from './pages/Transactions';
import Import from './pages/Import';
import Envelopes from './pages/Envelopes';
import DebtPlanner from './pages/DebtPlanner';
import Settings from './pages/Settings';
import Calendar from './pages/Calendar';
import Investments from './pages/Investments';
import Trends from './pages/Trends';
import Goals from './pages/Goals';
import Rules from './pages/Rules';

function ProtectedRoute({ children }) {
  const { user } = useAuth();
  if (user === undefined) return <div className="p-8 text-gray-500">Loading...</div>;
  if (!user) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <ThemeProvider>
      <AuthProvider>
        <BrowserRouter>
          <Routes>
            <Route path="/login" element={<Login />} />
            <Route path="/signup" element={<SignUp />} />
            <Route path="/" element={<ProtectedRoute><Layout /></ProtectedRoute>}>
              <Route index element={<Navigate to="/dashboard" replace />} />
              <Route path="dashboard"    element={<Dashboard />} />
              <Route path="transactions" element={<Transactions />} />
              <Route path="import"       element={<Import />} />
              <Route path="envelopes"    element={<Envelopes />} />
              <Route path="debt"         element={<DebtPlanner />} />
              <Route path="calendar"     element={<Calendar />} />
              <Route path="trends"       element={<Trends />} />
              <Route path="goals"        element={<Goals />} />
              <Route path="rules"        element={<Rules />} />
              <Route path="investments"  element={<Investments />} />
              <Route path="settings"     element={<Settings />} />
            </Route>
          </Routes>
        </BrowserRouter>
      </AuthProvider>
    </ThemeProvider>
  );
}
