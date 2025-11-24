// src/components/DarkModeToggle.tsx
import React, { useEffect, useState } from 'react';
import './DarkModeToggle.css'; // Import the CSS file

const DarkModeToggle: React.FC = () => {
  const [isDark, setIsDark] = useState(false);

  useEffect(() => {
    // Check localStorage for saved preference
    const savedTheme = localStorage.getItem('theme');
    const prefersDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
    
    const initialDark = savedTheme === 'dark' || (!savedTheme && prefersDark);
    setIsDark(initialDark);
    
    if (initialDark) {
      document.documentElement.classList.add('dark-mode');
    }
  }, []);

  const toggleDarkMode = (event: React.ChangeEvent<HTMLInputElement>) => {
    const newDarkMode = event.target.checked;
    setIsDark(newDarkMode);
    
    if (newDarkMode) {
      document.documentElement.classList.add('dark-mode');
      localStorage.setItem('theme', 'dark');
    } else {
      document.documentElement.classList.remove('dark-mode');
      localStorage.setItem('theme', 'light');
    }
  };

  return (
    <label className="switch">
      <input 
        type="checkbox" 
        checked={isDark}
        onChange={toggleDarkMode}
        id="checkbox"
      />
      <span className="slider">
        <div className="star star_1"></div>
        <div className="star star_2"></div>
        <div className="star star_3"></div>
        <svg viewBox="0 0 16 16" className="cloud_1 cloud">
          <path
            transform="matrix(.77976 0 0 .78395-299.99-418.63)"
            fill="#fff"
            d="m391.84 540.91c-.421-.329-.949-.524-1.523-.524-1.351 0-2.451 1.084-2.485 2.435-1.395.526-2.388 1.88-2.388 3.466 0 1.874 1.385 3.423 3.182 3.667v.034h12.73v-.006c1.775-.104 3.182-1.584 3.182-3.395 0-1.747-1.309-3.186-2.994-3.379.007-.106.011-.214.011-.322 0-2.707-2.271-4.901-5.072-4.901-2.073 0-3.856 1.202-4.643 2.925"
          />
        </svg>
      </span>
    </label>
  );
};

export default DarkModeToggle;
