import path from 'path';
import appJson from './app.json';

const { expo } = appJson;
const appPackage = expo.android.package;
const appScheme = expo.scheme;

export const config = {
  runner: 'local',

  hostname: 'localhost',
  port: 4723,

  tsConfigPath: './e2e/tsconfig.json',

  specs: ['./e2e/specs/**/*.spec.ts'],
  exclude: [],

  maxInstances: 1,

  capabilities: [
    {
      platformName: 'Android',
      'appium:automationName': 'UiAutomator2',
      'appium:deviceName': 'Android Emulator',
      'appium:app': path.resolve(__dirname, 'android/app/build/outputs/apk/debug/app-debug.apk'),
      'appium:appPackage': appPackage,
      'appium:appActivity': '.MainActivity',
      'appium:noReset': false,
      'appium:fullReset': false,
      'appium:newCommandTimeout': 240,
      'appium:adbExecTimeout': 60000,
      // Launch directly into app, bypassing Expo dev menu
      // 10.0.2.2 is the host machine IP from Android emulator's perspective
      // Requires Metro bundler running: pnpm dev
      'appium:optionalIntentArguments': `-d exp+${appScheme}://expo-development-client/?url=http%3A%2F%2F10.0.2.2%3A8081`,
    },
  ],

  logLevel: 'info',
  bail: 0,
  waitforTimeout: 30000,
  connectionRetryTimeout: 120000,
  connectionRetryCount: 3,

  services: [],

  framework: 'mocha',
  reporters: ['spec'],

  mochaOpts: {
    ui: 'bdd',
    timeout: 120000,
  },
};
