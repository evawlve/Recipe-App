import type { Metadata } from 'next';

// Fully static privacy policy. Required by Apple's HealthKit rules ("You must
// also provide a privacy policy for any app that uses the HealthKit framework")
// and linked from the App Store listing's privacyPolicyUrl. Like the landing
// page, this must never depend on the database or auth so it cannot break —
// a policy URL that 500s is an App Review rejection.
export const dynamic = 'force-static';

// The published contact address: the deletion-request path the policy promises.
// Diego's decision — do not change without his say-so.
const PRIVACY_CONTACT = 'team.mealspire@gmail.com';

const LAST_UPDATED = '30 August 2026';

export const metadata: Metadata = {
  title: 'Privacy Policy — Kinda Healthy',
  description:
    'What Kinda Healthy collects, what it does not, and what happens to health data read from Apple Health.',
};

type Block =
  | { kind: 'p'; lead?: string; text: string }
  | { kind: 'ul'; items: { lead?: string; text: string }[] };

type Section = { heading: string; blocks: Block[] };

const INTRO =
  'Kinda Healthy is a food-logging app. This policy explains what it collects, what it does not, and what happens to health data specifically. It applies to the iOS app and the service behind it.';

const SECTIONS: Section[] = [
  {
    heading: 'Health data (Apple Health / HealthKit)',
    blocks: [
      {
        kind: 'p',
        text: 'With your permission, Kinda Healthy reads exactly two kinds of data from Apple Health:',
      },
      {
        kind: 'ul',
        items: [{ text: 'Active Energy Burned' }, { text: 'Step Count' }],
      },
      {
        kind: 'p',
        text: 'That is the complete list. We ask for read access only — the app never writes anything to Apple Health and holds no write permission.',
      },
      {
        kind: 'p',
        lead: 'What we do with it.',
        text: 'These two figures are used on your device, to show your daily activity and to work out the calorie budget for that day. Nothing else.',
      },
      {
        kind: 'p',
        lead: 'Where it goes: nowhere.',
        text: 'Health data read from Apple Health is used on your device and is never transmitted off it. It is not sent to our servers, not stored in our database, and not included in backups we hold. We do not sell it, share it, or disclose it to any third party. We do not use it for advertising or marketing, and we do not use it for data mining, profiling or any purpose other than showing you your own activity inside the app.',
      },
      {
        kind: 'p',
        lead: 'Retention.',
        text: 'Health figures are held only for as long as the app needs them to draw the current screen. They are not written to our database and are not retained after you close the app; the app reads them again from Apple Health the next time it needs them.',
      },
      {
        kind: 'p',
        lead: 'How to turn it off.',
        text: 'You are in control and you can revoke access at any time, without uninstalling the app: open the Health app, tap your profile picture, then Apps and Services (labelled Sources on older versions of iOS), then Kinda Healthy, and turn off any category you no longer want to share. The app keeps working with the access removed; it simply stops showing measured activity and falls back to the activity level you chose during setup. iOS does not tell an app whether permission was granted or refused, so Kinda Healthy treats "no data" as not measured rather than as zero.',
      },
    ],
  },
  {
    heading: 'What else the app collects',
    blocks: [
      {
        kind: 'ul',
        items: [
          {
            lead: 'Your account.',
            text: 'Your email address, and a password stored only in hashed form by our authentication provider. We never see your password.',
          },
          {
            lead: 'What you tell us about yourself during setup.',
            text: 'Weight, height, age, biological sex, activity level and your weight goal — used to work out your calorie and macronutrient targets, and stored with your account so your targets survive reinstalling the app.',
          },
          {
            lead: 'Your food log.',
            text: 'The foods and meals you log, their quantities, and the date and meal you logged them to.',
          },
          {
            lead: 'What you type or say into Magic Log.',
            text: 'The text of a food entry is sent to our nutrition-matching service so it can be turned into foods with nutrition data. The text of the entry and the food record it matched are kept in a server-side log that we use to find and fix bad matches. Entries that fail to parse are recorded the same way.',
          },
          {
            lead: 'Barcodes you scan.',
            text: 'The digits of the barcode are sent to our lookup service. The camera image is not. Frames are decoded on your device and are never saved, uploaded or retained — the app requests the camera solely to read a barcode.',
          },
          {
            lead: 'Speech.',
            text: 'If you dictate a food entry, the audio is transcribed on your device. Kinda Healthy does not record, store or upload audio; only the resulting text is used, exactly as if you had typed it.',
          },
        ],
      },
    ],
  },
  {
    heading: 'What the app does not collect',
    blocks: [
      {
        kind: 'p',
        text: 'No advertising identifiers. No analytics or tracking SDKs of any kind — the iOS app contains none. No location. No contacts. No photos or photo library access. No cross-app or cross-site tracking. We do not sell personal data, and we do not share it with data brokers or advertisers.',
      },
      {
        kind: 'p',
        lead: 'This website.',
        text: 'This page is served by our web host, which collects aggregate, cookie-free visit statistics — page views and page-performance timings. Those statistics are not linked to your account, and they are not combined with anything you do in the app.',
      },
    ],
  },
  {
    heading: 'Who else processes data',
    blocks: [
      {
        kind: 'ul',
        items: [
          {
            lead: 'Our database and authentication provider',
            text: 'stores your account, your targets and your food log on our behalf.',
          },
          {
            lead: 'Our API host',
            text: 'runs the service that matches your food entries.',
          },
          {
            lead: 'Nutrition data sources',
            text: '— Open Food Facts, USDA FoodData Central and fatsecret — are queried to find nutrition information. Those queries carry the food term only; they do not carry your identity, your account, your health data or your food log.',
          },
        ],
      },
    ],
  },
  {
    heading: 'Keeping and deleting your data',
    blocks: [
      {
        kind: 'p',
        text: `Your account data and food log are kept for as long as your account exists. To delete your account and everything stored with it, write to ${PRIVACY_CONTACT} and we will delete it. You can remove health access at any time using the steps above, which takes effect immediately and independently of anything else.`,
      },
    ],
  },
  {
    heading: 'Children',
    blocks: [
      {
        kind: 'p',
        text: 'Kinda Healthy is not directed to children under 13 and we do not knowingly collect data from them.',
      },
    ],
  },
  {
    heading: 'Changes',
    blocks: [
      {
        kind: 'p',
        text: 'If this policy changes we will update the date at the top of this page.',
      },
    ],
  },
];

function Blocks({ blocks }: { blocks: Block[] }) {
  return (
    <>
      {blocks.map((block, i) =>
        block.kind === 'p' ? (
          <p key={i} className="mt-4 text-base font-semibold leading-relaxed text-muted">
            {block.lead ? <strong className="text-foreground">{block.lead} </strong> : null}
            {block.text}
          </p>
        ) : (
          <ul key={i} className="mt-4 space-y-3">
            {block.items.map((item, j) => (
              <li
                key={j}
                className="border-l-4 border-border pl-4 text-base font-semibold leading-relaxed text-muted"
              >
                {item.lead ? <strong className="text-foreground">{item.lead} </strong> : null}
                {item.text}
              </li>
            ))}
          </ul>
        )
      )}
    </>
  );
}

export default function PrivacyPage() {
  return (
    <div className="mx-auto max-w-3xl px-4 py-16">
      <h1 className="text-4xl font-black tracking-tight sm:text-5xl">Privacy Policy</h1>
      <p className="mt-3 text-base font-bold text-muted">
        Kinda Healthy · Last updated: {LAST_UPDATED}
      </p>

      <p className="mt-6 text-lg font-semibold leading-relaxed text-muted">{INTRO}</p>

      {SECTIONS.map((section) => (
        <section key={section.heading} className="mt-12">
          <h2 className="text-2xl font-extrabold tracking-tight">{section.heading}</h2>
          <Blocks blocks={section.blocks} />
        </section>
      ))}

      <section className="mt-12">
        <h2 className="text-2xl font-extrabold tracking-tight">Contact</h2>
        <div className="chunky-card mt-4 p-6">
          <a
            href={`mailto:${PRIVACY_CONTACT}`}
            className="text-base font-extrabold underline decoration-2 underline-offset-4"
          >
            {PRIVACY_CONTACT}
          </a>
        </div>
      </section>
    </div>
  );
}
