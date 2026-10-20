import { NavLink } from 'react-router-dom';

const TABS = [
  { to: '/org', label: 'Организация', end: true },
  { to: '/org/billing', label: 'Подписка' },
  { to: '/org/channels', label: 'Каналы' },
  { to: '/org/team', label: 'Сотрудники' },
];

export default function OrgAdminShell({ title, lead, children }) {
  return (
    <div className="org-admin">
      <header className="org-admin-header">
        <div>
          <h1>{title}</h1>
          {lead ? <p className="org-admin-lead">{lead}</p> : null}
        </div>
      </header>

      <nav className="org-admin-tabs" aria-label="Разделы организации">
        {TABS.map((tab) => (
          <NavLink
            key={tab.to}
            to={tab.to}
            end={Boolean(tab.end)}
            className={({ isActive }) => `org-admin-tab${isActive ? ' is-active' : ''}`}
          >
            {tab.label}
          </NavLink>
        ))}
      </nav>

      <div className="org-admin-body">{children}</div>
    </div>
  );
}
