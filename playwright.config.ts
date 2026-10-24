import { defineConfig } from "@playwright/test";

const interactive = process.argv.includes("--ui") || process.argv.includes("--debug");
if (process.env.CI) throw new Error("E2EはWindowsローカル専用です。CIでは実行しません。");
if (process.platform !== "win32" || (!process.env.OFFSTAGE_DESKTOP && !interactive)) {
  throw new Error("隠しデスクトップ上で pnpm test:e2e を実行してください。");
}

export default defineConfig({
  testDir: "./tests/e2e",
  timeout: 20_000,
  expect: { timeout: 5_000 },
  // 同一の隠しデスクトップ内でフォーカスを競合させない。
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  reporter: [["line"], ["html", { open: "never" }]],
  outputDir: "test-results/playwright",
  use: {
    browserName: "chromium",
    channel: "msedge",
    headless: false,
    baseURL: "http://127.0.0.1:1422",
    viewport: { width: 1120, height: 760 },
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: {
      args: [
        "--disable-features=CalculateNativeWinOcclusion",
        "--disable-renderer-backgrounding",
        "--disable-backgrounding-occluded-windows",
        "--disable-background-timer-throttling",
      ],
    },
  },
  webServer: {
    command: "pnpm build && pnpm exec vite preview --host 127.0.0.1 --port 1422 --strictPort",
    url: "http://127.0.0.1:1422",
    reuseExistingServer: false,
    timeout: 30_000,
  },
});
