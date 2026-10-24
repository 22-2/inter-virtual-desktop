import { spawn } from "node:child_process";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { enabled, helper, spawnArgs } from "offstage-windows";

const require = createRequire(import.meta.url);
const root = fileURLToPath(new URL("../", import.meta.url));

async function main() {
  if (process.env.CI) {
    console.log("E2Eをスキップしました。offstage-windowsを使うWindowsローカル専用テストです。");
    return 0;
  }
  if (process.platform !== "win32" || !enabled()) {
    throw new Error(
      "E2EにはWindowsと有効なoffstage-windowsが必要です。OFFSTAGE=0では実行しません。",
    );
  }
  const args = process.argv.slice(2);
  if (args.some((arg) => arg === "--ui" || arg === "--debug") || process.env.PWDEBUG) {
    throw new Error("対話実行には pnpm test:e2e:ui を使ってください。");
  }

  // 非表示ヘルパーが使えない場合、可視ウィンドウで実行するフォールバックを防ぐ。
  const hiddenHelper = helper();
  const [file, hiddenArgs] = spawnArgs(
    process.execPath,
    [require.resolve("@playwright/test/cli"), "test", ...args],
    { timeout: 300 },
  );
  if (file !== hiddenHelper)
    throw new Error("隠しデスクトップを用意できないためE2Eを中止しました。");
  console.log("offstage-windowsの隠しデスクトップでPlaywrightを実行します。");
  return new Promise((resolve, reject) => {
    const child = spawn(file, hiddenArgs, {
      cwd: root,
      windowsHide: true,
      stdio: "inherit",
      env: {
        ...process.env,
        PLAYWRIGHT_HTML_OPEN: "never",
        PW_TEST_HTML_REPORT_OPEN: "never",
        OFFSTAGE_REPORT_DIR: fileURLToPath(new URL("../test-results/offstage/", import.meta.url)),
      },
    });
    const stop = () => child.kill();
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    child.once("error", reject);
    child.once("exit", (code) => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      resolve(code ?? 1);
    });
  });
}

main().then(
  (code) => {
    process.exitCode = code;
  },
  (error) => {
    console.error(error.message);
    process.exitCode = 1;
  },
);
