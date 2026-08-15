import { Navigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabaseConfigured } from '../lib/supabaseClient';

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth();

  if (!supabaseConfigured) {
    return children;
  }

  if (loading) {
    return <div className="auth-loading">Loading…</div>;
  }

  if (!user) {
    return <Navigate to="/login" replace />;
  }

  return children;
}
