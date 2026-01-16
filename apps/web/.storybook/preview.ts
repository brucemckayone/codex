import '../src/lib/styles/global.css';

export const parameters = {
  backgrounds: {
    default: 'light',
    values: [
      { name: 'light', value: '#fafafa' },
      { name: 'dark', value: '#171717' },
    ],
  },
  controls: {
    matchers: {
      color: /(background|color)$/i,
      date: /Date$/,
    },
  },
};
