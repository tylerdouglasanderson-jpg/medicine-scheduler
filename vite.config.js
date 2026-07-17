import { defineConfig } from 'vite';
import { viteSingleFile } from 'vite-plugin-singlefile';

export default defineConfig({
  plugins: [viteSingleFile()],
  resolve: { alias: { exceljs: 'exceljs/dist/exceljs.min.js' } },
  define: {
    __BUILD_VERSION__: JSON.stringify(
      `${process.env.npm_package_version ?? 'dev'} ${new Date().toISOString().slice(0, 10)}`
    )
  },
  build: { target: 'esnext', assetsInlineLimit: 100_000_000 },
  test: { environment: 'node' }
});
