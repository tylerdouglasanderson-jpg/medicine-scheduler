import { renameSync, copyFileSync } from 'node:fs';

renameSync('dist/index.html', 'dist/med-scheduler.html');
copyFileSync('src/ui/guide.html', 'dist/med-scheduler-guide.html');
