import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/AuthContext';
import { supabaseConfigured } from '../lib/supabaseClient';
import Brand from '../components/Brand';

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
      <aside className="auth-aside">
        <Brand as={Link} to="/" />
        <div className="auth-aside-copy">
          <h1>
            Slides in.
            <br />
            <mark>Study material</mark>
            <br />
            out.
          </h1>
          <p>Flashcards, board-style questions and anatomy quizzes, built from your own lecture files.</p>
        </div>
        <p className="auth-aside-foot">Free to start. No card needed.</p>
      </aside>

      <main className="auth-main">
        <div className="auth-card">
          <h2>{isSignup ? 'Create an account' : 'Sign in'}</h2>

          {!supabaseConfigured && (
            <p className="warning">
              Accounts aren’t set up here yet, so sign-in isn’t connected to anything.{' '}
              <Link to="/dashboard">Continue to the dashboard</Link>
            </p>
          )}

          {status === 'check-email' ? (
            <p className="auth-check-email">
              Check <strong>{email}</strong> for a confirmation link, then sign in.
            </p>
          ) : (
            <form onSubmit={handleSubmit} className="auth-form">
              <label>
                <span className="eyebrow">Email</span>
                <input
                  type="email"
                  required
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  autoComplete="email"
                />
              </label>
              <label>
                <span className="eyebrow">Password</span>
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
                {status === 'working' ? 'One moment…' : isSignup ? 'Create account' : 'Sign in'}
              </button>
            </form>
          )}

          <p className="auth-switch">
            {isSignup ? (
              <>Already have an account? <Link to="/login">Sign in</Link></>
            ) : (
              <>New here? <Link to="/signup">Create an account</Link></>
            )}
          </p>
        </div>
      </main>
    </div>
  );
}
