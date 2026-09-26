import { useState, type FormEvent } from 'react';
import { ArrowRight, Eye, EyeOff, LockKeyhole, Mail, ShieldCheck } from 'lucide-react';
import type { Profile } from '../supervisor';
import { bottomCorner, corner, landscape, logo } from '../brandAssets';

export default function AuthGate({ onAuthenticated }: { onAuthenticated: (profile: Profile) => void }) {
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [visible, setVisible] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function submit(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      const response = await fetch('/api/auth/login', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ email: email.trim(), password }) });
      const result = await response.json().catch(() => ({ error: `Server error (${response.status}): the sign-in API did not respond.` }));
      if (!response.ok) { setError(result.error || 'Unable to sign in. Check your details and try again.'); return; }
      onAuthenticated(result);
    } catch {
      setError('Unable to connect. Check your connection and try again.');
    } finally {
      setPending(false);
    }
  }

  return (
    <main className="reference-auth">
      <section className="reference-auth__art" aria-label="About JalSakshi" style={{ backgroundImage: `url(${landscape})` }}>
        <div className="brand"><img src={logo} alt="" /><span>JalSakshi<small>Water quality workspace</small></span></div>
        <div className="reference-auth__story">
          <h1>Every source.<br />Every signal.<br /><em>In focus.</em></h1>
          <p>Turn field evidence into clear, accountable action for the communities you serve.</p>
        </div>
      </section>
      <section className="reference-auth__form-side" aria-label="Supervisor sign in">
        <p className="reference-auth__promise">Field evidence <ArrowRight size={20} /> Clear action</p>
        <img className="reference-auth__top-shape" src={corner} alt="" />
        <img className="reference-auth__bottom-shape" src={bottomCorner} alt="" />
        <div className="reference-auth__form-wrap">
          <span className="reference-auth__shield"><ShieldCheck size={30} strokeWidth={1.8} /></span>
          <h2>Welcome back.</h2>
          <p className="reference-auth__intro">Sign in to your JalSakshi workspace.</p>
          <form className="reference-auth__form" onSubmit={submit}>
            <label htmlFor="email">Email address</label>
            <div className="reference-auth__input"><Mail size={24} /><input id="email" type="email" autoComplete="username" placeholder="you@email.org" value={email} onChange={event => setEmail(event.target.value)} required disabled={pending} /></div>
            <label htmlFor="password">Password</label>
            <div className="reference-auth__input"><LockKeyhole size={23} /><input id="password" type={visible ? 'text' : 'password'} autoComplete="current-password" placeholder="Password" value={password} onChange={event => setPassword(event.target.value)} required disabled={pending} /><button type="button" aria-label={visible ? 'Hide password' : 'Show password'} onClick={() => setVisible(!visible)}>{visible ? <EyeOff size={24} /> : <Eye size={24} />}</button></div>
            {error && <p className="auth-error" role="alert">{error}</p>}
            <button className="reference-auth__submit" disabled={pending} type="submit"><span>{pending ? 'Signing in…' : 'Sign in'}</span><ArrowRight size={28} /></button>
          </form>
          <p className="reference-auth__help">Use your assigned district account.<br />Contact your administrator if you need access.</p>
        </div>
      </section>
    </main>
  );
}
