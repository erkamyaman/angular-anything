import { copyFileSync, mkdirSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';

const here = import.meta.dirname;
const dist = join(here, 'dist');
const angular = createRequire(import.meta.url).resolve('angular/angular.js');

rmSync(dist, { recursive: true, force: true });
mkdirSync(dist);
copyFileSync(join(here, 'index.html'), join(dist, 'index.html'));
copyFileSync(join(here, 'app.js'), join(dist, 'app.js'));
copyFileSync(angular, join(dist, 'angular.js'));
