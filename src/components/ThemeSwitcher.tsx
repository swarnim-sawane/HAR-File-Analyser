import React, { useRef } from 'react';
import type { ThemeMode } from '../theme';
import './ThemeSwitcher.css';

interface ThemeSwitcherProps {
  theme: ThemeMode;
  onChange: (theme: ThemeMode) => void;
}

const themeOptions: Array<{ value: ThemeMode; label: string; description: string }> = [
  { value: 'light', label: 'Light', description: 'Bright neutral surfaces' },
  { value: 'dark', label: 'Dark', description: 'Low-light contrast mode' },
  { value: 'redwood', label: 'Redwood', description: 'Oracle-inspired warm enterprise theme' },
];

const ThemeSwitcher: React.FC<ThemeSwitcherProps> = ({ theme, onChange }) => {
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);

  const focusOption = (index: number) => {
    optionRefs.current[index]?.focus();
  };

  const moveSelection = (index: number) => {
    const nextOption = themeOptions[index];
    if (!nextOption) return;
    onChange(nextOption.value);
    focusOption(index);
  };

  const handleOptionKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, currentIndex: number) => {
    const lastIndex = themeOptions.length - 1;

    switch (event.key) {
      case 'ArrowRight':
      case 'ArrowDown':
        event.preventDefault();
        moveSelection(currentIndex === lastIndex ? 0 : currentIndex + 1);
        break;
      case 'ArrowLeft':
      case 'ArrowUp':
        event.preventDefault();
        moveSelection(currentIndex === 0 ? lastIndex : currentIndex - 1);
        break;
      case 'Home':
        event.preventDefault();
        moveSelection(0);
        break;
      case 'End':
        event.preventDefault();
        moveSelection(lastIndex);
        break;
      default:
        break;
    }
  };

  return (
    <div className="theme-switcher" role="radiogroup" aria-label="Theme">
      {themeOptions.map((option, index) => {
        const isActive = theme === option.value;

        return (
          <button
            key={option.value}
            ref={(element) => {
              optionRefs.current[index] = element;
            }}
            type="button"
            role="radio"
            aria-checked={isActive}
            aria-label={`${option.label} theme`}
            tabIndex={isActive ? 0 : -1}
            className={`theme-switcher-option ${isActive ? 'is-active' : ''}`}
            onClick={() => onChange(option.value)}
            onKeyDown={(event) => handleOptionKeyDown(event, index)}
            title={option.description}
          >
            <span
              className={`theme-switcher-swatch theme-switcher-swatch--${option.value}`}
              aria-hidden="true"
            />
            <span className="theme-switcher-label">{option.label}</span>
          </button>
        );
      })}
    </div>
  );
};

export default ThemeSwitcher;
