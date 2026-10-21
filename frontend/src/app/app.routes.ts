import { Routes } from '@angular/router';
import { authGuard, guestGuard, rootRedirectGuard, verifiedGuard } from './core/auth/guards';
import { LiveStore } from './core/live/live-store';
import { LIVE_MAP_KEEP_ALIVE } from './core/routing/keep-alive-route-strategy';
import { AppShell } from './layout/app-shell';

/**
 * Route map. Screens are lazy-loaded standalone components.
 * - Outside the shell: auth, onboarding, live game, full-screen GM tools, public pages.
 * - Inside the shell (nav bar): everything else.
 */
export const routes: Routes = [
  { path: '', pathMatch: 'full', canActivate: [rootRedirectGuard], children: [] },

  // --- public / signed-out ---------------------------------------------------
  { path: 'welcome', canActivate: [guestGuard], title: 'Airsoft Zeus', loadComponent: () => import('./features/auth/welcome').then((m) => m.WelcomeScreen) },
  { path: 'auth/sign-up', canActivate: [guestGuard], title: 'Create account', loadComponent: () => import('./features/auth/sign-up').then((m) => m.SignUpScreen) },
  { path: 'auth/login', canActivate: [guestGuard], title: 'Log in', loadComponent: () => import('./features/auth/login').then((m) => m.LoginScreen) },
  { path: 'auth/forgot-password', title: 'Forgot password', loadComponent: () => import('./features/auth/forgot-password').then((m) => m.ForgotPasswordScreen) },
  { path: 'auth/reset-password', title: 'Reset password', loadComponent: () => import('./features/auth/reset-password').then((m) => m.ResetPasswordScreen) },
  /** Shows "check your inbox"; with ?token=… it verifies. Works signed in or out. */
  { path: 'auth/verify-email', title: 'Verify email', loadComponent: () => import('./features/auth/verify-email').then((m) => m.VerifyEmailScreen) },
  { path: 'r/:token', title: 'Event results', loadComponent: () => import('./features/results/public-results').then((m) => m.PublicResultsScreen) },
  { path: 'offline', title: 'Offline', loadComponent: () => import('./features/system/offline').then((m) => m.OfflineScreen) },
  { path: 'error', title: 'Error', loadComponent: () => import('./features/system/error').then((m) => m.ErrorScreen) },

  // --- onboarding (signed in) ------------------------------------------------------
  { path: 'onboarding/consent', canActivate: [authGuard], title: 'Terms and privacy', loadComponent: () => import('./features/onboarding/consent').then((m) => m.ConsentScreen) },
  { path: 'onboarding/permissions', canActivate: [verifiedGuard], title: 'Permissions', loadComponent: () => import('./features/onboarding/permissions').then((m) => m.PermissionsScreen) },

  // --- live game (full screen, own bottom nav) ------------------------------------
  {
    path: 'events/:eventId/live',
    canActivate: [verifiedGuard],
    providers: [LiveStore],
    loadComponent: () => import('./features/live/live-shell').then((m) => m.LiveShell),
    children: [
      { path: '', title: 'Live map', data: { keepAlive: LIVE_MAP_KEEP_ALIVE }, loadComponent: () => import('./features/live/live-map').then((m) => m.LiveMapScreen) },
      { path: 'objectives', title: 'Objectives', loadComponent: () => import('./features/live/objective-list').then((m) => m.ObjectiveListScreen) },
      { path: 'objectives/:objectiveId', title: 'Objective', loadComponent: () => import('./features/live/objective-details').then((m) => m.ObjectiveDetailsScreen) },
      /** ?objective=<id> preselects the objective being captured */
      { path: 'scan', title: 'Scan QR code', loadComponent: () => import('./features/live/qr-scanner').then((m) => m.QrScannerScreen) },
      { path: 'team', title: 'Team', loadComponent: () => import('./features/live/team').then((m) => m.TeamScreen) },
      { path: 'store', title: 'Store', loadComponent: () => import('./features/live/perk-store').then((m) => m.PerkStoreScreen) },
      { path: 'more', title: 'More', loadComponent: () => import('./features/live/more').then((m) => m.LiveMoreScreen) },
    ],
  },

  // --- GM full-screen tools ------------------------------------------------------------
  {
    path: 'gm/events/:eventId/control',
    canActivate: [verifiedGuard],
    providers: [LiveStore],
    title: 'Control center',
    loadComponent: () => import('./features/gm/control-center/control-center').then((m) => m.ControlCenterScreen),
  },
  {
    path: 'gm/events/:eventId/map',
    canActivate: [verifiedGuard],
    title: 'Tactical map editor',
    loadComponent: () => import('./features/gm/map-editor/map-editor').then((m) => m.MapEditorScreen),
  },

  // --- shell -------------------------------------------------------------------
  {
    path: '',
    component: AppShell,
    canActivate: [verifiedGuard],
    children: [
      { path: 'home', title: 'Home', loadComponent: () => import('./features/home/home').then((m) => m.HomeScreen) },
      { path: 'events/discover', title: 'Discover events', loadComponent: () => import('./features/events/discover').then((m) => m.DiscoverScreen) },
      /** ?tab=upcoming|past|gm|invitations */
      { path: 'events/mine', title: 'My events', loadComponent: () => import('./features/events/my-events').then((m) => m.MyEventsScreen) },
      /** ?code=ABC123 prefills the code (deep link from an invitation QR) */
      { path: 'events/join', title: 'Join event', loadComponent: () => import('./features/events/join-event').then((m) => m.JoinEventScreen) },
      { path: 'events/:eventId', title: 'Event', loadComponent: () => import('./features/events/event-details').then((m) => m.EventDetailsScreen) },
      { path: 'events/:eventId/lobby', title: 'Lobby', loadComponent: () => import('./features/lobby/lobby').then((m) => m.LobbyScreen) },
      { path: 'events/:eventId/results', title: 'Results', loadComponent: () => import('./features/results/event-results').then((m) => m.EventResultsScreen) },
      { path: 'events/:eventId/results/stats', title: 'Post-game statistics', loadComponent: () => import('./features/results/post-game-stats').then((m) => m.PostGameStatsScreen) },
      { path: 'events/:eventId/results/export', title: 'Export results', loadComponent: () => import('./features/results/export-results').then((m) => m.ExportResultsScreen) },
      { path: 'news', title: 'News', loadComponent: () => import('./features/news/news-list').then((m) => m.NewsListScreen) },
      /** newsId may be 'new' (admins only) */
      { path: 'news/:newsId/edit', title: 'Edit news', loadComponent: () => import('./features/news/news-editor').then((m) => m.NewsEditorScreen) },
      { path: 'news/:newsId', title: 'News', loadComponent: () => import('./features/news/news-detail').then((m) => m.NewsDetailScreen) },
      { path: 'support', title: 'Help & feedback', loadComponent: () => import('./features/support/support-list').then((m) => m.SupportListScreen) },
      /** ?category=bug|report|general preselects the kind; ?from=/path is attached to bug reports */
      { path: 'support/new', title: 'New message', loadComponent: () => import('./features/support/support-new').then((m) => m.SupportNewScreen) },
      { path: 'support/:ticketId', title: 'Help & feedback', loadComponent: () => import('./features/support/support-thread').then((m) => m.SupportThreadScreen) },
      { path: 'notifications', title: 'Notifications', loadComponent: () => import('./features/notifications/notifications').then((m) => m.NotificationsScreen) },
      { path: 'profile', title: 'Profile', loadComponent: () => import('./features/profile/profile').then((m) => m.ProfileScreen) },
      { path: 'profile/edit', title: 'Edit profile', loadComponent: () => import('./features/profile/edit-profile').then((m) => m.EditProfileScreen) },
      { path: 'profile/stats', title: 'Statistics', loadComponent: () => import('./features/profile/statistics').then((m) => m.StatisticsScreen) },
      { path: 'players/:userId', title: 'Player', loadComponent: () => import('./features/profile/public-profile').then((m) => m.PublicProfileScreen) },
      /** clubId may be 'new' */
      { path: 'clubs/:clubId', title: 'Club', loadComponent: () => import('./features/clubs/club').then((m) => m.ClubScreen) },
      { path: 'settings', title: 'Settings', loadComponent: () => import('./features/settings/settings').then((m) => m.SettingsScreen) },
      { path: 'settings/privacy', title: 'Privacy', loadComponent: () => import('./features/settings/privacy-settings').then((m) => m.PrivacySettingsScreen) },

      { path: 'gm/new', title: 'Create event', loadComponent: () => import('./features/gm/wizard/create-event-wizard').then((m) => m.CreateEventWizardScreen) },
      { path: 'gm/events/:eventId', title: 'Event editor', loadComponent: () => import('./features/gm/event-editor').then((m) => m.EventEditorScreen) },
      { path: 'gm/events/:eventId/teams', title: 'Teams and squads', loadComponent: () => import('./features/gm/team-squad-manager').then((m) => m.TeamSquadManagerScreen) },
      /** objectiveId may be 'new' (?lat=&lng= prefill) */
      { path: 'gm/events/:eventId/objectives/:objectiveId', title: 'Objective editor', loadComponent: () => import('./features/gm/objective-editor').then((m) => m.ObjectiveEditorScreen) },
      /** poiId may be 'new' (?lat=&lng= prefill) */
      { path: 'gm/events/:eventId/pois/:poiId', title: 'POI editor', loadComponent: () => import('./features/gm/poi-editor').then((m) => m.PoiEditorScreen) },
      { path: 'gm/events/:eventId/perks', title: 'Perk store', loadComponent: () => import('./features/gm/perk-editor').then((m) => m.PerkEditorScreen) },
      { path: 'gm/events/:eventId/players', title: 'Players', loadComponent: () => import('./features/gm/player-management').then((m) => m.PlayerManagementScreen) },
      { path: 'gm/events/:eventId/scores', title: 'Scores and currency', loadComponent: () => import('./features/gm/score-manager').then((m) => m.ScoreManagerScreen) },
      { path: 'gm/events/:eventId/activity', title: 'Activity log', loadComponent: () => import('./features/gm/activity-log').then((m) => m.ActivityLogScreen) },
    ],
  },

  { path: '**', title: 'Not found', loadComponent: () => import('./features/system/not-found').then((m) => m.NotFoundScreen) },
];
