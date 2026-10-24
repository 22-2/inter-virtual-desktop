import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";

export function AppIcon({ hwnd, appName }: { hwnd: number; appName: string }) {
  const [icon, setIcon] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    setIcon(null);
    void invoke<string | null>("get_window_icon", { hwnd })
      .then((source) => {
        if (!cancelled) setIcon(source);
      })
      .catch((reason) => {
        console.warn("アプリアイコンを取得できませんでした", reason);
      });
    return () => {
      cancelled = true;
    };
  }, [hwnd, appName]);

  return (
    <span
      className={`app-icon ${appName.toLowerCase().includes("explorer") ? "explorer" : ""} ${icon ? "has-image" : ""}`}
      aria-hidden="true"
    >
      {icon ? (
        <img
          src={icon}
          alt=""
          width={16}
          height={16}
          draggable={false}
          onError={() => setIcon(null)}
        />
      ) : (
        appName.slice(0, 1).toUpperCase()
      )}
    </span>
  );
}
