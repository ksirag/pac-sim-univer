import { Icon, type IconName } from './Icon';
import { navigate } from './router';

const TABS: { id: string; label: string; icon: IconName }[] = [
  { id: 'activity', label: 'Активность', icon: 'activity' },
  { id: 'routes', label: 'Маршруты', icon: 'route' },
  { id: 'history', label: 'История', icon: 'history' },
  { id: 'settings', label: 'Настройки', icon: 'settings' },
];

export function BottomNav({ current, live }: { current: string; live: boolean }) {
  return (
    <nav className="bottom-nav" aria-label="Основная навигация">
      {TABS.map((t) => (
        <a
          key={t.id}
          href={`#/${t.id}`}
          className="nav-item"
          aria-current={current === t.id ? 'page' : undefined}
          onClick={(e) => {
            e.preventDefault();
            navigate(`/${t.id}`, { replace: true });
          }}
        >
          <span className="nav-icon">
            <Icon name={t.icon} />
            {live && t.id === 'activity' ? <span className="live-dot" aria-label="Идёт активность" /> : null}
          </span>
          <span>{t.label}</span>
        </a>
      ))}
    </nav>
  );
}
