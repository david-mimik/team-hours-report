// One ES5 bundle (build/index.js) for the mimOE Duktape runtime. Keep it small: it is loaded for every request.
// The report page is not in it (see src/index.js). ?raw stays available for small text assets (prompts, templates).
const path = require('path');
const TerserPlugin = require('terser-webpack-plugin');

const DEBUG = process.env.DEBUG === 'true';

module.exports = {
  mode: DEBUG ? 'development' : 'production',
  target: ['web', 'es5'],
  entry: [
    'core-js/es/promise',
    'core-js/es/array/find',
    'core-js/es/array/from',
    'core-js/es/array/includes',
    'core-js/es/map',
    'core-js/es/set',
    'core-js/es/symbol',
    'core-js/es/symbol/iterator',
    'core-js/es/object/assign',
    'core-js/es/object/entries',
    'core-js/es/object/values',
    path.resolve(__dirname, 'src/index.js'),
  ],
  output: { path: path.resolve(__dirname, 'build'), filename: 'index.js' },
  optimization: {
    minimize: !DEBUG,
    minimizer: [new TerserPlugin({ extractComments: false, terserOptions: { output: { comments: false } } })],
  },
  module: {
    rules: [{
      oneOf: [
        { resourceQuery: /raw/, type: 'asset/source' },
        {
          test: /\.(?:js|mjs|cjs)$/,
          exclude: [/node_modules[\\/]core-js/, /node_modules[\\/]webpack[\\/]buildin/],
          use: {
            loader: 'babel-loader',
            options: {
              presets: [['@babel/preset-env', {
                useBuiltIns: 'entry',
                corejs: { version: '3.36.1', proposals: false },
                modules: 'commonjs',
                targets: { browsers: ['ie 11'] },
              }]],
              sourceType: 'unambiguous',
            },
          },
        },
      ],
    }],
  },
  resolve: { symlinks: false, extensions: ['.js'], fallback: { url: require.resolve('url/') } },
  performance: { hints: false },
  devtool: DEBUG ? 'source-map' : false,
};
