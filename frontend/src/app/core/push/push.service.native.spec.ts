import { PLATFORM_ID } from '@angular/core';
import { TestBed } from '@angular/core/testing';
import { Router } from '@angular/router';
import { SwPush } from '@angular/service-worker';
import { ApiService } from '../api/api.service';
import { ConfigService } from '../api/config.service';
import { NativePush } from '../native/native-app';
import { PushService } from './push.service';

type Listener = (event: unknown) => void;

/** Fake @capacitor/push-notifications: register() answers with a 'registration' event. */
class FakePushPlugin {
  readonly listeners = new Map<string, Listener[]>();
  receive: 'prompt' | 'granted' | 'denied' = 'granted';
  registered = 0;
  unregistered = 0;
  readonly channels: string[] = [];

  addListener(event: string, cb: Listener) {
    this.listeners.set(event, [...(this.listeners.get(event) ?? []), cb]);
    return Promise.resolve({ remove: async () => void this.listeners.set(event, (this.listeners.get(event) ?? []).filter((l) => l !== cb)) });
  }
  emit(event: string, data: unknown) {
    for (const l of this.listeners.get(event) ?? []) l(data);
  }
  checkPermissions = async () => ({ receive: this.receive });
  requestPermissions = async () => {
    this.receive = 'granted';
    return { receive: this.receive };
  };
  register = async () => {
    this.registered++;
    queueMicrotask(() => this.emit('registration', { value: `token-${this.registered}` }));
  };
  unregister = async () => void this.unregistered++;
  createChannel = async (c: { id: string }) => void this.channels.push(c.id);
}

const settle = async () => {
  for (let i = 0; i < 5; i++) await new Promise((r) => setTimeout(r, 0));
};

describe('PushService in the native app', () => {
  let plugin: FakePushPlugin;
  let saved: unknown[];
  let deleted: string[];
  let nativePushOnServer: boolean;
  let navigated: string[];

  function create(): PushService {
    TestBed.configureTestingModule({
      providers: [
        { provide: PLATFORM_ID, useValue: 'browser' },
        { provide: NativePush, useValue: { available: true, android: true, plugin: async () => ({ plugin }) } },
        { provide: SwPush, useValue: { isEnabled: false } },
        {
          provide: ApiService,
          useValue: {
            savePushSubscription: async (s: unknown) => void saved.push(s),
            deletePushSubscription: async (t: string) => void deleted.push(t),
          },
        },
        { provide: ConfigService, useValue: { load: async () => ({ nativePush: nativePushOnServer }) } },
        { provide: Router, useValue: { navigateByUrl: async (u: string) => navigated.push(u) } },
      ],
    });
    return TestBed.inject(PushService);
  }

  beforeEach(() => {
    plugin = new FakePushPlugin();
    saved = [];
    deleted = [];
    navigated = [];
    nativePushOnServer = true;
    localStorage.clear();
  });

  it('is supported, creates the Android channels and reads the permission at start', async () => {
    plugin.receive = 'prompt';
    const push = create();
    await settle();
    expect(push.supported).toBe(true);
    expect(push.permission()).toBe('default');
    expect(plugin.channels.sort()).toEqual(['alerts', 'emergency', 'general']);
  });

  it('asks permission, registers with FCM and saves the token', async () => {
    plugin.receive = 'prompt';
    const push = create();
    await settle();
    expect(await push.enable()).toBe(true);
    expect(push.permission()).toBe('granted');
    expect(saved).toEqual([{ fcmToken: 'token-1' }]);
    expect(push.subscribed()).toBe(true);
  });

  it('does not register when the server cannot send to the apps', async () => {
    nativePushOnServer = false;
    const push = create();
    await settle();
    expect(await push.ensureSubscribed()).toBe(false);
    expect(plugin.registered).toBe(0);
  });

  it('opens the page in the notification when it is tapped', async () => {
    create();
    await settle();
    plugin.emit('pushNotificationActionPerformed', { actionId: 'tap', notification: { data: { url: '/events/e1/live' } } });
    plugin.emit('pushNotificationActionPerformed', { actionId: 'tap', notification: { data: { url: 'https://evil.example' } } });
    expect(navigated).toEqual(['/events/e1/live']);
  });

  it('turning off removes the token and stays off on the next start', async () => {
    const push = create();
    await settle();
    await push.ensureSubscribed();
    await push.disable();
    expect(deleted).toEqual(['token-1']);
    expect(plugin.unregistered).toBe(1);
    expect(push.subscribed()).toBe(false);
    expect(await push.ensureSubscribed()).toBe(false);
    expect(plugin.registered).toBe(1);
  });
});
