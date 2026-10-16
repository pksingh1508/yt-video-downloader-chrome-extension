import { useEffect, useState } from 'react';
import { motion } from 'framer-motion';
import { Monitor, Moon, Sun } from 'lucide-react';

type Theme = 'light' | 'dark' | 'system';
const choices = [
  { value: 'light', label: 'Light theme', icon: Sun },
  { value: 'dark', label: 'Dark theme', icon: Moon },
  { value: 'system', label: 'System theme', icon: Monitor },
] as const;

export default function ThemeToggle() {
  const [theme, setTheme] = useState<Theme>(() => {
    try {
      const stored = localStorage.getItem('postready-theme');
      if (stored === 'light' || stored === 'dark') return stored;
    } catch {
      /* System appearance works without storage. */
    }
    return 'system';
  });

  useEffect(() => {
    const media = window.matchMedia('(prefers-color-scheme: dark)');
    const apply = () => {
      const resolved =
        theme === 'system' ? (media.matches ? 'dark' : 'light') : theme;
      document.documentElement.dataset.theme = resolved;
      document
        .querySelector('meta[name="theme-color"]')
        ?.setAttribute('content', resolved === 'dark' ? '#141413' : '#f8f7f4');
    };
    apply();
    try {
      localStorage.setItem('postready-theme', theme);
    } catch {
      /* Keep the preference in memory. */
    }
    media.addEventListener('change', apply);
    return () => media.removeEventListener('change', apply);
  }, [theme]);

  return (
    <div className="theme-toggle" role="group" aria-label="Color theme">
      {choices.map(({ value, label, icon: Icon }) => (
        <motion.button
          key={value}
          type="button"
          aria-label={label}
          aria-pressed={theme === value}
          title={label}
          onClick={() => setTheme(value)}
          whileTap={{ scale: 0.9 }}
        >
          {theme === value && (
            <motion.span
              className="theme-selection"
              layoutId="theme-selection"
              transition={{ type: 'spring', stiffness: 440, damping: 32 }}
            />
          )}
          <Icon size={15} />
        </motion.button>
      ))}
    </div>
  );
}
