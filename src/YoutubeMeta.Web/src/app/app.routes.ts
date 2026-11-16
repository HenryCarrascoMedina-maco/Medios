import { Routes } from '@angular/router';
import { authGuard, guestGuard } from './core/guards/auth.guard';
import { enabledGuideGuard } from './core/guards/platform.guard';

export const routes: Routes = [
  {
    path: 'login',
    canActivate: [guestGuard],
    loadComponent: () => import('./modules/login/login.page').then(m => m.LoginPage),
    title: 'Ingresar · YoutubeMeta'
  },
  {
    path: '',
    canActivate: [authGuard],
    loadComponent: () => import('./layout/shell.component').then(m => m.ShellComponent),
    children: [
      { path: '', pathMatch: 'full', redirectTo: 'home' },
      {
        path: 'home',
        loadComponent: () => import('./modules/home/home.page').then(m => m.HomePage),
        title: 'Inicio · YoutubeMeta'
      },
      {
        path: 'inbox',
        loadComponent: () => import('./modules/inbox/inbox.page').then(m => m.InboxPage),
        title: 'Bandeja · YoutubeMeta'
      },
      {
        path: 'inbox/:id',
        loadComponent: () => import('./modules/inbox/inbox.page').then(m => m.InboxPage),
        title: 'Bandeja · YoutubeMeta'
      },
      {
        path: 'library',
        loadComponent: () => import('./modules/library/library.page').then(m => m.LibraryPage),
        title: 'Medios · YoutubeMeta'
      },
      {
        path: 'videos/:id',
        loadComponent: () => import('./modules/video-detail/video-detail.page').then(m => m.VideoDetailPage),
        title: 'Video · YoutubeMeta'
      },
      {
        path: 'calendar',
        loadComponent: () => import('./modules/calendar/calendar.page').then(m => m.CalendarPage),
        title: 'Calendario · YoutubeMeta'
      },
      {
        path: 'insights',
        loadComponent: () => import('./modules/insights/insights.page').then(m => m.InsightsPage),
        title: 'Resultados · YoutubeMeta'
      },
      {
        path: 'publications',
        loadComponent: () => import('./modules/publications/publications.page').then(m => m.PublicationsPage),
        title: 'Publicaciones · YoutubeMeta'
      },
      {
        path: 'connections',
        loadComponent: () => import('./modules/connections/connections.page').then(m => m.ConnectionsPage),
        title: 'Conexiones · YoutubeMeta'
      },
      {
        path: 'settings',
        loadComponent: () => import('./modules/settings/settings.page').then(m => m.SettingsPage),
        title: 'Ajustes · YoutubeMeta'
      },
      {
        path: 'settings/inbox',
        loadComponent: () => import('./modules/settings/inbox-settings.page').then(m => m.InboxSettingsPage),
        title: 'Bandeja · Ajustes · YoutubeMeta'
      },
      {
        path: 'settings/templates',
        loadComponent: () => import('./modules/settings/templates/templates.page').then(m => m.TemplatesPage),
        title: 'Plantillas · Ajustes · YoutubeMeta'
      },
      {
        // :id = número o «new». Con cambios sin guardar, pregunta antes de salir.
        path: 'settings/templates/:id',
        loadComponent: () => import('./modules/settings/templates/template-edit.page').then(m => m.TemplateEditPage),
        canDeactivate: [(page: { canLeave(): boolean | Promise<boolean> }) => page.canLeave()],
        title: 'Plantilla · Ajustes · YoutubeMeta'
      },
      { path: 'guides', pathMatch: 'full', redirectTo: 'guides/youtube' },
      {
        path: 'guides/:platform',
        canActivate: [enabledGuideGuard],
        loadComponent: () => import('./modules/guides/guide.page').then(m => m.GuidePage),
        title: 'Guía · YoutubeMeta'
      }
    ]
  },
  { path: '**', redirectTo: '' }
];
