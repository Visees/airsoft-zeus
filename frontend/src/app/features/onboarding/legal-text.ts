/**
 * Terms of Service and Privacy Policy shown at sign-up, on the consent screen and in Settings.
 * The version that the user accepts comes from ConfigService (termsVersion / privacyVersion);
 * update these texts and bump the server version together.
 */

export interface LegalSection {
  heading: string;
  paragraphs: string[];
}

export interface LegalDoc {
  id: 'terms' | 'privacy';
  title: string;
  /** Plain-language key points shown before the full text. */
  summary: string[];
  sections: LegalSection[];
}

export const TERMS: LegalDoc = {
  id: 'terms',
  title: 'Terms of Service',
  summary: [
    'AirsoftHub is a tool to organise and run airsoft games. The field rules, safety rules and the Game Master on site always come first.',
    'You must be old enough to play airsoft where you live and follow the law and the rules of the field.',
    'Game Masters are responsible for the events they create, including their rules, teams and scoring.',
    'Do not cheat: no spoofed GPS, shared capture codes or fake accounts. Game Masters can remove you from an event and we can suspend your account.',
    'The app depends on GPS and mobile signal. Never rely on it for safety or emergencies — call the emergency number.',
  ],
  sections: [
    {
      heading: '1. What the service is',
      paragraphs: [
        'AirsoftHub ("the app") lets players join airsoft events and lets Game Masters ("GMs") create events, set up a tactical map, objectives, teams, points, credits and perks, and run the game live.',
        'The app is a coordination tool. It does not organise, insure or supervise the physical event. The organiser of each event and the owner of the playing field are responsible for the event itself, for safety briefings, chrono checks and for compliance with local law.',
      ],
    },
    {
      heading: '2. Your account',
      paragraphs: [
        'You need a verified email address and a unique nickname. Keep your password private; you are responsible for activity on your account.',
        'Your nickname is public: other players see it on the map, in teams and in results. Do not use a nickname that impersonates someone, is offensive or contains personal data of others.',
        'You must meet the minimum age required to play airsoft in your country and at the field. If you are under the age of digital consent where you live, a parent or guardian must agree to these terms.',
      ],
    },
    {
      heading: '3. Playing fair',
      paragraphs: [
        'Do not falsify your location (mock GPS apps, emulators), share or guess capture codes, scan QR codes outside the game, automate actions, create multiple accounts or interfere with the service.',
        'GMs may review captures, revoke points, apply penalties and remove players from their events. We may suspend or close accounts that break these terms, after reviewing reports.',
      ],
    },
    {
      heading: '4. Game Masters',
      paragraphs: [
        'GMs decide the rules, teams, scoring and visibility settings of their events, including how precisely player positions are shown to others. GMs must explain these settings to players before the game.',
        'GMs may see personal information that players choose to share with them (for example an emergency contact). They must use it only to run the event safely and must not copy or keep it after the event.',
      ],
    },
    {
      heading: '5. Safety',
      paragraphs: [
        'GPS can be inaccurate by tens of metres and the mobile network can drop. Positions, timers and alerts in the app may be late or wrong.',
        'The app is not an emergency service. In an emergency stop the game, follow the field safety procedure and call the local emergency number. Do not look at your phone while moving through the playing area unless it is safe to do so.',
      ],
    },
    {
      heading: '6. Content you add',
      paragraphs: [
        'You keep the rights to the content you upload (photos, descriptions, maps). You allow us to store and show it to the people who need to see it to run the service. Do not upload content you do not have the right to share.',
      ],
    },
    {
      heading: '7. Availability and liability',
      paragraphs: [
        'We work to keep the service available but cannot guarantee it is always online or free of errors. To the extent allowed by law, we are not liable for lost games, points or results, or for injuries or damage that happen during an event.',
        'Nothing in these terms limits rights you have under consumer law that cannot be excluded.',
      ],
    },
    {
      heading: '8. Ending your account and changes',
      paragraphs: [
        'You can delete your account at any time in Settings. We may update these terms; when we do, we show the new version and ask you to accept it before you continue.',
      ],
    },
  ],
};

export const PRIVACY: LegalDoc = {
  id: 'privacy',
  title: 'Privacy Policy',
  summary: [
    'Your location is used only while you are in a live event you joined, and only after you allow it. You can stop sharing at any time.',
    'Other players see your nickname, avatar and — if you allow it — your club, role, country and stats. Never your name, email, date of birth or emergency contact.',
    'Precise location history is visible only to the Game Masters of that event and is deleted after your retention period (7, 30 or 90 days).',
    'Your emergency contact is shared with a Game Master only if you turn that option on.',
    'You can export or delete your data at any time from Settings.',
  ],
  sections: [
    {
      heading: '1. What we collect',
      paragraphs: [
        'Account data: email address, password (stored only as a secure hash), nickname, and the consents you give with their date and version.',
        'Profile data you choose to add: first and last name, date of birth, country, language, avatar, club, player role, bio and emergency contact.',
        'Game data: events you join, team and squad, ready state, captures, points, credits, perk purchases, results and badges.',
        'Location data: GPS position, accuracy, speed and heading, collected only during live events (see section 3).',
        'Technical data: device type, app version, push notification subscription and security logs (for example failed logins) used to protect your account.',
      ],
    },
    {
      heading: '2. Why we use it',
      paragraphs: [
        'To run your account and the events you take part in (contract), to keep the service secure and prevent cheating (legitimate interest), and — only with your consent — to use your location, send push notifications and share your emergency contact with Game Masters.',
        'We do not sell your data and do not use it for advertising.',
      ],
    },
    {
      heading: '3. Location tracking',
      paragraphs: [
        'Your device sends its position only while you have a live event open and you have allowed location for that event. Nothing is collected outside live events, in the lobby before the start, or after you leave the game.',
        'Who sees your position during the game depends on the event rules set by the Game Master (for example only your squad, your team, or an approximate area). Enemy players see you only if the rules or a perk allow it, and the app tells you when that is possible.',
        'You can stop sharing at any time from the live screen or by turning off location permission in your browser or phone settings. Some objectives that require holding a zone cannot be captured without location.',
        'Precise location history is visible only to the Game Masters of that event (for safety and to check captures) and is deleted automatically after your retention period, which you choose in Privacy settings: 7, 30 or 90 days. Aggregated results without coordinates (captures, points) are kept with the event results.',
      ],
    },
    {
      heading: '4. Who can see what',
      paragraphs: [
        'Other players: your nickname and avatar; your club, player role, country and statistics only if you enable them in Privacy settings.',
        'Game Masters of events you join: the same as players, plus your membership status, permissions, live position as allowed by the event, and your emergency contact only if you turned on sharing.',
        'Never shown to other users: your email, first and last name, date of birth and password.',
        'Service providers that host the app, send emails and deliver push notifications process data on our behalf under contract and only to provide the service.',
      ],
    },
    {
      heading: '5. Emergency contact',
      paragraphs: [
        'Adding an emergency contact is optional. If you enable sharing, the Game Masters of events you join can see the contact name, phone number and relation during that event so they can reach someone if you are injured. You can turn this off at any time.',
      ],
    },
    {
      heading: '6. How long we keep data',
      paragraphs: [
        'Location history: deleted after your retention period (7, 30 or 90 days).',
        'Account and profile data: kept while your account exists. When you delete your account, your profile, email and personal data are deleted within 30 days; your nickname in past results is replaced by "Deleted player" so other people\'s results stay correct.',
        'Security logs: kept up to 12 months. Backups are overwritten within 35 days.',
      ],
    },
    {
      heading: '7. Your rights',
      paragraphs: [
        'You can see and correct your data in your profile, download a copy of all your data from Settings (Export my data), withdraw any consent, and delete your account. You can also object to processing or lodge a complaint with your data protection authority.',
      ],
    },
    {
      heading: '8. Changes',
      paragraphs: [
        'If we change this policy we show the new version and ask you to review it before you continue using the app.',
      ],
    },
  ],
};
