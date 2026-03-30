import postcssGlobalData from '@csstools/postcss-global-data';
import postcssCustomMedia from 'postcss-custom-media';

export default {
  plugins: [
    postcssGlobalData({
      files: ['./src/lib/styles/tokens/breakpoints.css'],
    }),
    postcssCustomMedia({
      preserve: false,
    }),
  ],
};
