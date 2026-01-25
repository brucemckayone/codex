import '../src/lib/styles/global.css';

export const parameters = {
  backgrounds: {
    options: {
      light: { name: 'light', value: '#fafafa' },
      dark: { name: 'dark', value: '#171717' },
    },
  },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
};

export const initialGlobals = {
  backgrounds: {
    value: 'light',
  },
};
