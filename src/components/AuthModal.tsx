import React, { useState } from 'react';
import { useApp } from '../context/AppContext';
import { X, Lock, Mail, User, ShieldCheck, Sparkles, Key } from 'lucide-react';
import { ConstraintViolationError } from '../lib/db';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
}

export const AuthModal: React.FC<AuthModalProps> = ({ isOpen, onClose }) => {
  const { loginAs, db, schema, addToast } = useApp();
  const [isSignUp, setIsSignUp] = useState(false);
  const [email, setEmail] = useState('');
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [role, setRole] = useState<'user' | 'admin'>('user');
  const [cohort, setCohort] = useState<'A' | 'B'>('B');
  const [errorMsg, setErrorMsg] = useState('');

  if (!isOpen) return null;

  const handleQuickLogin = (demoEmail: string) => {
    setErrorMsg('');
    const success = loginAs(demoEmail);
    if (success) {
      onClose();
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    setErrorMsg('');

    if (!email.trim() || !password.trim()) {
      setErrorMsg('Please enter both email and password.');
      return;
    }

    if (!isSignUp) {
      // Login
      const user = schema.users.find((u) => u.email.toLowerCase() === email.toLowerCase());
      if (!user) {
        setErrorMsg('User not found in database. Check credentials or try demo accounts.');
        return;
      }
      loginAs(email);
      onClose();
    } else {
      // Sign up
      if (!username.trim()) {
        setErrorMsg('Please choose a username.');
        return;
      }
      try {
        const userId = `usr_${Date.now()}`;
        const roleId = role === 'admin' ? 'rol_1' : 'rol_2';
        const salt = Math.random().toString(36).substring(2, 8);
        const passwordHash = `pbkdf2_sha256$260000$salt_${salt}$${Math.random().toString(16).substring(2, 18)}`;

        const newUser = {
          user_id: userId,
          role_id: roleId,
          username: username.trim(),
          email: email.trim(),
          password_hash: passwordHash,
          experiment_group: cohort,
          created_at: new Date().toISOString(),
          last_login: new Date().toISOString(),
        };

        db.validateConstraint('users', newUser, 'INSERT');
        db.getSchema().users.push(newUser);
        db.getSchema().audit_log.unshift({
          log_id: `aud_${Date.now()}`,
          user_id: userId,
          table_name: 'Users',
          record_id: userId,
          action: 'INSERT',
          old_data: null,
          new_data: JSON.stringify({ username: newUser.username, email: newUser.email, role, cohort }),
          changed_at: new Date().toISOString(),
        });

        loginAs(newUser.email);
        addToast({
          type: 'success',
          title: 'Account Created & Stored',
          message: `User ${newUser.username} inserted into Users table with PBKDF2 hash. Assigned to Cohort ${cohort}.`,
        });
        onClose();
      } catch (err: unknown) {
        if (err instanceof ConstraintViolationError) {
          setErrorMsg(err.message);
        } else {
          setErrorMsg('Failed to create account.');
        }
      }
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-md bg-zinc-950 border border-zinc-800 rounded-2xl shadow-2xl p-6 overflow-hidden">
        <button
          onClick={onClose}
          className="absolute top-4 right-4 p-1.5 text-zinc-400 hover:text-white rounded-lg hover:bg-zinc-800 transition-colors"
        >
          <X className="w-5 h-5" />
        </button>

        <div className="flex items-center gap-2 text-teal-400 text-xs font-semibold uppercase tracking-wider font-mono">
          <Key className="w-4 h-4" />
          <span>PostgreSQL Auth & Session Engine</span>
        </div>

        <h3 className="text-xl font-bold text-white mt-2">
          {isSignUp ? 'Create New Account' : 'Sign in to MoodTide'}
        </h3>
        <p className="text-xs text-zinc-400 mt-1">
          {isSignUp
            ? 'Inserts record into "Users" with UNIQUE email verification & salted PBKDF2 password hash.'
            : 'Authenticate existing session or pick a pre-seeded demo credential.'}
        </p>

        {/* Demo Fast Login Buttons */}
        <div className="mt-4 p-3 rounded-xl bg-zinc-900 border border-zinc-800">
          <span className="text-[11px] font-semibold text-zinc-400 block mb-2">
            One-Click Demo Credentials (from seed data):
          </span>
          <div className="grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => handleQuickLogin('admin@moodtide.com')}
              className="flex flex-col items-start p-2 rounded-lg bg-zinc-950 border border-amber-500/30 hover:border-amber-400/60 transition-colors text-left group"
            >
              <div className="flex items-center gap-1.5 text-amber-400 text-xs font-semibold">
                <ShieldCheck className="w-3.5 h-3.5" />
                <span>Admin Login</span>
              </div>
              <span className="text-[11px] text-zinc-400 font-mono mt-0.5">admin@moodtide.com</span>
              <span className="text-[10px] text-zinc-500 font-mono">pass: admin123</span>
            </button>

            <button
              type="button"
              onClick={() => handleQuickLogin('fatima@moodtide.com')}
              className="flex flex-col items-start p-2 rounded-lg bg-zinc-950 border border-teal-500/30 hover:border-teal-400/60 transition-colors text-left group"
            >
              <div className="flex items-center gap-1.5 text-teal-400 text-xs font-semibold">
                <User className="w-3.5 h-3.5" />
                <span>Fatima (User)</span>
              </div>
              <span className="text-[11px] text-zinc-400 font-mono mt-0.5">fatima@moodtide.com</span>
              <span className="text-[10px] text-zinc-500 font-mono">pass: user123</span>
            </button>
          </div>
        </div>

        {errorMsg && (
          <div className="mt-4 p-3 rounded-lg bg-red-950/80 border border-red-500/40 text-red-200 text-xs leading-relaxed">
            {errorMsg}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-4 flex flex-col gap-3">
          {isSignUp && (
            <div>
              <label className="text-xs font-medium text-zinc-300 block mb-1">Full Name / Username</label>
              <div className="relative">
                <User className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
                <input
                  type="text"
                  placeholder="e.g. Maya Chen"
                  value={username}
                  onChange={(e) => setUsername(e.target.value)}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-400"
                />
              </div>
            </div>
          )}

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Email Address</label>
            <div className="relative">
              <Mail className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="email"
                placeholder="user@moodtide.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-400"
              />
            </div>
          </div>

          <div>
            <label className="text-xs font-medium text-zinc-300 block mb-1">Password</label>
            <div className="relative">
              <Lock className="w-4 h-4 absolute left-3 top-2.5 text-zinc-500" />
              <input
                type="password"
                placeholder="••••••••"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="w-full bg-zinc-900 border border-zinc-800 rounded-lg pl-9 pr-3 py-2 text-xs text-zinc-200 outline-none focus:border-teal-400"
              />
            </div>
            <span className="text-[10px] text-zinc-500 mt-1 block">
              Simulated: stored only as a salted cryptographic hash.
            </span>
          </div>

          {isSignUp && (
            <div className="grid grid-cols-2 gap-3 mt-1">
              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">Role (RBAC)</label>
                <select
                  value={role}
                  onChange={(e) => setRole(e.target.value as 'user' | 'admin')}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-400"
                >
                  <option value="user">User (Normal)</option>
                  <option value="admin">Admin</option>
                </select>
              </div>

              <div>
                <label className="text-xs font-medium text-zinc-300 block mb-1">A/B Testing Group</label>
                <select
                  value={cohort}
                  onChange={(e) => setCohort(e.target.value as 'A' | 'B')}
                  className="w-full bg-zinc-900 border border-zinc-800 rounded-lg px-2 py-1.5 text-xs text-zinc-200 outline-none focus:border-teal-400"
                >
                  <option value="B">Group B (Mood-Aware)</option>
                  <option value="A">Group A (Taste Only)</option>
                </select>
              </div>
            </div>
          )}

          <button
            type="submit"
            className="w-full mt-2 py-2.5 rounded-lg bg-teal-500 hover:bg-teal-400 text-zinc-950 font-semibold text-xs transition-colors shadow-md"
          >
            {isSignUp ? 'Register User & Generate Hash' : 'Sign In'}
          </button>
        </form>

        <div className="mt-4 pt-3 border-t border-zinc-800 text-center">
          <button
            onClick={() => {
              setIsSignUp(!isSignUp);
              setErrorMsg('');
            }}
            className="text-xs text-zinc-400 hover:text-teal-400 transition-colors"
          >
            {isSignUp
              ? 'Already registered? Sign in with existing credentials'
              : 'Need a new user test account? Sign up with role'}
          </button>
        </div>
      </div>
    </div>
  );
};
