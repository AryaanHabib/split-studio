import * as esbuild from 'esbuild';
await esbuild.build({ entryPoints: ['web/preview-controller.ts'], bundle: true, format: 'iife', outfile: 'public/runtime/preview.js', target: 'es2022', minify: true, logLevel: 'warning' });
console.log('built public/runtime/preview.js');
