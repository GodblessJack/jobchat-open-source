import type { Config } from 'tailwindcss';

export default {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: 'class',
  theme: {
    extend: {
      colors: {
        wechat: {
          bg: '#f5f5f5',
          chat: '#ededed',
          self: '#95ec69',
          other: '#ffffff',
          accent: '#07c160',
          'accent-soft': 'rgba(7, 193, 96, 0.1)'
        }
      },
      fontFamily: {
        sans: [
          '-apple-system',
          'BlinkMacSystemFont',
          'PingFang SC',
          'Microsoft YaHei',
          'sans-serif'
        ]
      },
      animation: {
        fadeIn: 'fadeIn 0.2s ease-out',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0', transform: 'translateY(-4px)' },
          '100%': { opacity: '1', transform: 'translateY(0)' },
        },
      }
    }
  },
  plugins: []
} satisfies Config;
