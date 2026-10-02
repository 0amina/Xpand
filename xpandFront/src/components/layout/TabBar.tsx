import { NavLink } from 'react-router-dom';

import { haptics } from '@/lib/telegram';

import './layout.css';

/**
 * Four tabs, not three.
 *
 * The obvious layout is Home / Add / History with a type picker inside "Add" — but that costs
 * an extra tap on the single most repeated action in the app. Income and Expense therefore get
 * their own tabs and their own colour, so logging anything is always exactly one tap from
 * anywhere. That is the whole brief: minimal clicks, fast daily entry.
 */
const TABS = [
  { to: '/', label: 'Home', icon: '◎', end: true, tone: '' },
  { to: '/add/income', label: 'Income', icon: '↓', end: false, tone: 'income' },
  { to: '/add/expense', label: 'Expense', icon: '↑', end: false, tone: 'expense' },
  { to: '/transactions', label: 'History', icon: '≡', end: false, tone: '' },
] as const;

export function TabBar() {
  return (
    <nav className="tabbar" aria-label="Main">
      {TABS.map((tab) => (
        <NavLink
          key={tab.to}
          to={tab.to}
          end={tab.end}
          onClick={() => haptics.impact('light')}
          className={({ isActive }) =>
            ['tabbar__item', tab.tone && `tabbar__item--${tab.tone}`, isActive && 'is-active']
              .filter(Boolean)
              .join(' ')
          }
        >
          <span className="tabbar__icon" aria-hidden="true">
            {tab.icon}
          </span>
          <span className="tabbar__label">{tab.label}</span>
        </NavLink>
      ))}
    </nav>
  );
}
