import { Component } from '@angular/core';
import { Footer } from './footer';
import { Header } from './header';
import { Main } from './main';

@Component({
  selector: 'section[id=root]',
  imports: [Header, Main, Footer],
  template: `<header class="header" data-testid="header"></header><main class="main" data-testid="main"></main><footer class="footer" data-testid="footer"></footer>`,
})
export class App {}
