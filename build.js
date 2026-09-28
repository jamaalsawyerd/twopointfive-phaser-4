const esbuild = require('esbuild');
const path = require('path');

// Shared with dev-server.js, whose live mode runs this same build in esbuild's watch mode.
const buildOptions = {
  entryPoints: [path.join(__dirname, 'src', 'phaser-game.ts')],
  bundle: true,
  format: 'iife',
  outfile: path.join(__dirname, 'dist', 'game.js'),
  globalName: 'TwoPointFiveGame',
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: false,
  sourcemap: true,
  target: ['es2016'],
  alias: { '~': path.join(__dirname, 'src') }
};

async function main() {
  await esbuild.build(buildOptions).catch(() => process.exit(1));
}

module.exports = { buildOptions };

if (require.main === module) main();
