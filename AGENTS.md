# 検証

- UIの通常の回帰確認は、Computer Useでの手動操作ではなく`pnpm test:e2e`を使う。
- E2EはWindowsローカル専用。`offstage-windows`の隠しデスクトップで実行し、CIには組み込まない。
- 隠し環境が利用できない場合に通常画面へフォールバックしない。対話デバッグは`pnpm test:e2e:ui`で明示的に行う。
- 絞り込み実行は`pnpm test:e2e tests/e2e/menus.spec.ts`または`--grep`を使う。
- テストコードを変更したら`pnpm typecheck:e2e`も実行する。
- E2EのTauri IPCはモック。Windows APIの実行結果を、モックのコマンド送信確認だけで検証済みと扱わない。
- ネイティブ処理の変更時は`cargo test --manifest-path src-tauri/Cargo.toml --lib`を実行する。
- 既存のユーザー差分を保持し、テスト成果物（`test-results/`・`playwright-report/`）はコミットしない。
