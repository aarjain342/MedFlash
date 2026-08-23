import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabaseConfigured } from '../lib/supabaseClient';

export default function AuthPage({ mode }) {
  const isSignup = mode === 'signup';
  const { user, signIn, signUp } = useAuth();
  const navigate = useNavigate();

  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [status, setStatus] = useState('idle'); // idle | working | error | check-email
  const [error, setError] = useState('');

  if (user) return <Navigate to="/dashboard" replace />;

  async function handleSubmit(e) {
    e.preventDefault();
    setStatus('working');
    setError('');

    const { error: authError, data } = isSignup
      ? await signUp(email, password)
      : await signIn(email, password);

    if (authError) {
      setError(authError.message);
      setStatus('error');
      return;
    }

    if (isSignup && !data.session) {
      // Email confirmation is required before a session exists
      setStatus('check-email');
      return;
    }

    navigate('/dashboard');
  }

  return (
    <div className="auth-page">
      <Link to="/" className="brand auth-brand">
        <span className="brand-mark" aria-hidden="true" />
        <span className="brand-name">MedFlash</span>
      </Link>

      <div className="auth-card panel">
        <h1>{isSignup ? 'Create your account' : 'Welcome back'}</h1>
        <p className="muted">
          {isSignup ? 'Start turning lecture PDFs into flashcards.' : 'Sign in to your dashboard.'}
        </p>

        {!supabaseConfigured && (
          <p className="warning">
            Accounts aren't set up yet — sign-in isn't wired to anything real. You can jump straight
            to the dashboard for now.
            <br />
            <Link to="/dashboard" className="pill-button-inline">Continue to dashboard →</Link>
          </p>
        )}

        {status === 'check-email' ? (
          <p className="auth-check-email">
            Almost there — check <strong>{email}</strong> for a confirmation link before signing in.
          </p>
        ) : (
          <form onSubmit={handleSubmit} className="auth-form">
            <label>
              Email
              <input
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
              />
            </label>
            <label>
              Password
              <input
                type="password"
                required
                minLength={6}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                autoComplete={isSignup ? 'new-password' : 'current-password'}
              />
            </label>

            {error && <p className="error">{error}</p>}

            <button className="primary auth-submit" disabled={status === 'working'}>
              {status === 'working' ? 'Please wait…' : isSignup ? 'Sign up' : 'Sign in'}
            </button>
          </form>
        )}

        <p className="auth-switch">
          {isSignup ? (
            <>Already have an account? <Link to="/login">Sign in</Link></>
          ) : (
            <>Don't have an account? <Link to="/signup">Sign up</Link></>
          )}
        </p>
      </div>
    </div>
  );
}
