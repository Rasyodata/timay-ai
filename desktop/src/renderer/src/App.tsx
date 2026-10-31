import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { api, hasToken, setToken, type User } from './api';
import { AgendaView, TasksView } from './Agenda';
import { CalculatorsView } from './Calculators';
import { CasesView, CaseView } from './Cases';
import { ConsultancyClientView, ConsultancyView } from './Consultancy';
import { ContractsView, ContractView } from './Contracts';
import { NotificationBell } from './Notifications';
import { ContractGroupView } from './ContractGroups';
import { DashboardView } from './Dashboard';
import { DeadlinesView } from './Deadlines';
import { EstatesView, EstateView } from './Estates';
import { EnforcementFileView, EnforcementView } from './Enforcement';
import { FinanceView } from './Finance';
import { DecisionsView } from './Archive';
import { TeamView } from './Office';
import { applyTheme, ConnectionBanner, SettingsGate, SettingsView } from './Settings';
import { OpposingView, PetitionView } from './Petition';
import { PowersView } from './Powers';
import { TemplatesView } from './Templates';
import { ErrorText, Icon, type IconName } from './ui';

applyTheme();

export type View =
  | { name: 'dashboard' }
  | { name: 'cases' }
  | { name: 'case'; id: number; tab?: string }
  | { name: 'petition'; id: number; review?: boolean }
  | { name: 'opposing'; id: number }
  | { name: 'templates' }
  | { name: 'agenda' }
  | { name: 'tasks' }
  | { name: 'contracts' }
  | { name: 'contract'; id: number }
  | { name: 'contract-group'; id: number }
  | { name: 'finance' }
  | { name: 'enforcement' }
  | { name: 'enforcement-file'; id: number }
  | { name: 'consultancy' }
  | { name: 'estates' }
  | { name: 'deadlines'; tab?: string }
  | { name: 'estate'; id: number }
  | { name: 'consultancy-client'; id: number }
  | { name: 'decisions' }
  | { name: 'team' }
  | { name: 'settings' }
  | { name: 'calculators' }
  | { name: 'powers'; id?: number };

export type Go = (view: View) => void;

export function App() {
  const [user, setUser] = useState<User | null>(null);
  const [checking, setChecking] = useState(hasToken());

  useEffect(() => {
    if (!hasToken()) return;
    api<User>('/me')
      .then(setUser)
      .catch(() => setToken(null))
      .finally(() => setChecking(false));
  }, []);

  if (checking) return <div className="splash">Timay</div>;
  if (!user) return <AuthScreen onLogin={setUser} />;
  return (
    <Shell
      user={user}
      onLogout={() => {
        setToken(null);
        setUser(null);
      }}
    />
  );
}

function AuthScreen({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register' | 'invite'>('login');
  const [form, setForm] = useState({ officeName: '', name: '', email: '', password: '', token: '' });
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [settings, setSettings] = useState<'closed' | 'gate' | 'open'>('closed');
  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: { target: { value: string } }) => setForm({ ...form, [key]: e.target.value }),
  });

  async function submit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setBusy(true);
    try {
      const path = mode === 'login' ? '/login' : mode === 'register' ? '/register' : '/invites/accept';
      const body =
        mode === 'login'
          ? { email: form.email, password: form.password }
          : mode === 'register'
            ? { officeName: form.officeName, name: form.name, email: form.email, password: form.password }
            : { token: form.token, name: form.name, password: form.password };
      const result = await api<{ token: string; user: User }>(path, { body });
      setToken(result.token);
      onLogin(result.user);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  if (settings === 'open')
    return (
      <div className="auth-settings">
        <SettingsView onClose={() => setSettings('closed')} />
      </div>
    );

  return (
    <div className="auth-screen">
      {settings === 'gate' && <SettingsGate user={null} onOpen={() => setSettings('open')} onCancel={() => setSettings('closed')} />}
      <aside className="auth-brand">
        <div className="logo">
          <span className="logo-mark">T</span> Timay
        </div>
        <h1>Hukuk büronuz için tek program</h1>
        <p>Dava dosyaları, dilekçeler, duruşmalar, sözleşmeler, icra ve muhasebe tek yerde. Her dilekçe başka bir avukatın onayından geçer.</p>
        <ul>
          <li>
            <Icon name="check" /> Dayanakları kaynağına göre denetleyen Teyit
          </li>
          <li>
            <Icon name="check" /> 10 hukuk alanında hazır dilekçe şablonları
          </li>
          <li>
            <Icon name="check" /> Sözleşme risk ve taahhüt takibi
          </li>
          <li>
            <Icon name="check" /> İcra takibi ve büro muhasebesi
          </li>
        </ul>
      </aside>
      <main className="auth-form">
        <form onSubmit={submit}>
          <h2>{mode === 'login' ? 'Hoş geldiniz' : mode === 'register' ? 'Büronuzu oluşturun' : 'Davetle katılın'}</h2>
          <p className="muted">
            {mode === 'login'
              ? 'E-posta ve şifrenizle giriş yapın.'
              : mode === 'register'
                ? 'Şifrenizi kendiniz belirleyin; bundan sonra girişte bu şifreyi kullanacaksınız.'
                : 'Büronuzdan aldığınız davet kodunu girin.'}
          </p>
          <div className="segmented">
            <button type="button" className={mode === 'login' ? 'active' : ''} onClick={() => setMode('login')}>
              Giriş
            </button>
            <button type="button" className={mode === 'register' ? 'active' : ''} onClick={() => setMode('register')}>
              Büro aç
            </button>
            <button type="button" className={mode === 'invite' ? 'active' : ''} onClick={() => setMode('invite')}>
              Davet kodu
            </button>
          </div>
          {mode === 'register' && (
            <label className="field">
              <span>Büro adı</span>
              <input {...field('officeName')} placeholder="ör. Fırat Hukuk Bürosu" required />
            </label>
          )}
          {mode === 'invite' && (
            <label className="field">
              <span>Davet kodu</span>
              <input {...field('token')} required />
            </label>
          )}
          {mode !== 'login' && (
            <label className="field">
              <span>Ad soyad</span>
              <input {...field('name')} required />
            </label>
          )}
          {mode !== 'invite' && (
            <label className="field">
              <span>E-posta</span>
              <input type="email" {...field('email')} required />
            </label>
          )}
          <label className="field">
            <span>Şifre {mode !== 'login' && '(en az 8 karakter)'}</span>
            <input type="password" minLength={8} {...field('password')} required />
          </label>
          <ErrorText error={error} />
          <button className="primary big" type="submit" disabled={busy}>
            {busy ? 'Bekleyin…' : mode === 'login' ? 'Giriş yap' : mode === 'register' ? 'Büroyu oluştur' : 'Hesabı oluştur'}
          </button>
          <p className="muted small server">
            <button type="button" className="link" onClick={() => setSettings('gate')}>
              <Icon name="gear" /> Sistem ayarları
            </button>
          </p>
        </form>
      </main>
    </div>
  );
}

const NAV: { section: string; items: { name: View['name']; label: string; icon: IconName }[] }[] = [
  {
    section: 'Büro',
    items: [
      { name: 'dashboard', label: 'Ana sayfa', icon: 'home' },
      { name: 'agenda', label: 'Ajanda', icon: 'calendar' },
      { name: 'tasks', label: 'Görevler', icon: 'check' },
      { name: 'deadlines', label: 'Süreler ve riskler', icon: 'shield' },
      { name: 'calculators', label: 'Hesaplayıcılar', icon: 'calc' },
    ],
  },
  {
    section: 'Hukuk',
    items: [
      { name: 'cases', label: 'Dava dosyaları', icon: 'folder' },
      { name: 'powers', label: 'Vekâletnameler', icon: 'pen' },
      { name: 'templates', label: 'Dilekçe şablonları', icon: 'book' },
      { name: 'contracts', label: 'Sözleşmeler', icon: 'contract' },
      { name: 'consultancy', label: 'Danışmanlık', icon: 'briefcase' },
      { name: 'estates', label: 'Miras', icon: 'tree' },
      { name: 'enforcement', label: 'İcra takibi', icon: 'gavel' },
      { name: 'decisions', label: 'Yargıtay kararları', icon: 'scale' },
    ],
  },
  {
    section: 'Yönetim',
    items: [
      { name: 'finance', label: 'Muhasebe', icon: 'wallet' },
      { name: 'team', label: 'Ekip ve yetkiler', icon: 'users' },
    ],
  },
];

// Alt sayfaların hangi menü öğesine ait olduğu.
const PARENT: Partial<Record<View['name'], View['name']>> = {
  case: 'cases',
  petition: 'cases',
  opposing: 'cases',
  contract: 'contracts',
  'contract-group': 'contracts',
  'enforcement-file': 'enforcement',
  'consultancy-client': 'consultancy',
  estate: 'estates',
};

function Shell({ user, onLogout }: { user: User; onLogout: () => void }) {
  const [view, setView] = useState<View>({ name: 'dashboard' });
  const [gate, setGate] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const go: Go = (v) => {
    setView(v);
    document.querySelector('main.content')?.scrollTo(0, 0);
  };
  const active = PARENT[view.name] ?? view.name;

  let content: ReactNode;
  switch (view.name) {
    case 'dashboard':
      content = <DashboardView user={user} go={go} />;
      break;
    case 'cases':
      content = <CasesView go={go} />;
      break;
    case 'case':
      content = <CaseView id={view.id} user={user} go={go} initialTab={view.tab} />;
      break;
    case 'petition':
      content = <PetitionView key={view.id} id={view.id} user={user} autoReview={view.review} back={(caseId) => go({ name: 'case', id: caseId, tab: 'dilekceler' })} />;
      break;
    case 'opposing':
      content = <OpposingView id={view.id} back={(caseId) => go({ name: 'case', id: caseId, tab: 'karsi' })} />;
      break;
    case 'templates':
      content = <TemplatesView go={go} />;
      break;
    case 'agenda':
      content = <AgendaView go={go} />;
      break;
    case 'tasks':
      content = <TasksView user={user} go={go} />;
      break;
    case 'contracts':
      content = <ContractsView go={go} />;
      break;
    case 'contract':
      content = <ContractView id={view.id} user={user} go={go} />;
      break;
    case 'contract-group':
      content = <ContractGroupView key={view.id} id={view.id} go={go} />;
      break;
    case 'finance':
      content = <FinanceView go={go} />;
      break;
    case 'enforcement':
      content = <EnforcementView go={go} />;
      break;
    case 'enforcement-file':
      content = <EnforcementFileView id={view.id} go={go} />;
      break;
    case 'consultancy':
      content = <ConsultancyView go={go} />;
      break;
    case 'consultancy-client':
      content = <ConsultancyClientView id={view.id} go={go} />;
      break;
    case 'deadlines':
      content = <DeadlinesView go={go} initialTab={view.tab} />;
      break;
    case 'estates':
      content = <EstatesView go={go} />;
      break;
    case 'estate':
      content = <EstateView id={view.id} go={go} />;
      break;
    case 'decisions':
      content = <DecisionsView user={user} go={go} />;
      break;
    case 'team':
      content = <TeamView user={user} />;
      break;
    case 'powers':
      content = <PowersView key={view.id ?? 0} go={go} initialId={view.id} />;
      break;
    case 'calculators':
      content = <CalculatorsView />;
      break;
    case 'settings':
      content = <SettingsView onClose={() => go({ name: 'dashboard' })} onReconnected={() => setReloadKey((k) => k + 1)} />;
      break;
  }

  return (
    <div className="shell">
      <nav className="sidebar">
        <div className="logo">
          <span className="logo-mark">T</span> Timay
          <NotificationBell go={go} />
        </div>
        {NAV.map((group) => (
          <div key={group.section} className="nav-group">
            <div className="nav-section">{group.section}</div>
            {group.items.filter((item) => item.name !== 'finance' || user.can_finance).map((item) => (
              <button
                key={item.name}
                className={`nav-item ${active === item.name ? 'active' : ''}`}
                onClick={() => go({ name: item.name } as View)}
              >
                <Icon name={item.icon} />
                {item.label}
              </button>
            ))}
          </div>
        ))}
        <div className="spacer" />
        <div className="me">
          <span className="avatar">{user.name.slice(0, 1).toLocaleUpperCase('tr')}</span>
          <span className="me-text">
            <strong>{user.name}</strong>
            <span>{user.role === 'avukat' ? 'Avukat' : 'Stajyer'}</span>
          </span>
          {Boolean(user.is_admin) && (
            <button className={`ghost ${view.name === 'settings' ? 'active' : ''}`} onClick={() => setGate(true)} title="Sistem ayarları">
              <Icon name="gear" />
            </button>
          )}
          <button className="ghost" onClick={onLogout} title="Çıkış">
            <Icon name="logout" />
          </button>
        </div>
      </nav>
      <main className="content">
        <ConnectionBanner onSettings={() => setGate(true)} onReconnected={() => setReloadKey((k) => k + 1)} />
        <div key={reloadKey} className="content-inner">
          {content}
        </div>
      </main>
      {gate && (
        <SettingsGate
          user={user}
          onOpen={() => {
            setGate(false);
            go({ name: 'settings' });
          }}
          onCancel={() => setGate(false)}
        />
      )}
    </div>
  );
}
