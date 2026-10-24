use serde::Serialize;

#[cfg(target_os = "windows")]
mod app_icons;

#[cfg(target_os = "windows")]
mod window_focus;

#[derive(Clone, Serialize)]
struct DesktopInfo {
    index: u32,
    name: String,
    current: bool,
}

#[derive(Clone, Serialize)]
struct WindowInfo {
    hwnd: isize,
    title: String,
    app_name: String,
    desktop_index: u32,
    minimized: bool,
    pinned: bool,
}

#[derive(Serialize)]
struct Snapshot {
    desktops: Vec<DesktopInfo>,
    windows: Vec<WindowInfo>,
}

#[cfg(target_os = "windows")]
mod platform {
    use super::{DesktopInfo, Snapshot, WindowInfo};
    use super::app_icons;
    use tauri::command;
    use windows::{
        Win32::{
            Foundation::{BOOL, HWND, LPARAM},
            UI::WindowsAndMessaging::{
                EnumWindows, GW_OWNER, GWL_EXSTYLE, GetWindow, GetWindowLongW,
                GetWindowTextLengthW, GetWindowTextW, IsIconic,
                IsWindowVisible, PostMessageW, WM_CLOSE, WS_EX_TOOLWINDOW,
            },
        },
    };

    fn desktop_error(error: impl std::fmt::Debug) -> String {
        format!("{error:?}. winvdはWindows 11 24H2 (build 26100.2605) 以降が必要です。")
    }

    fn process_name(hwnd: HWND) -> String {
        app_icons::process_path(hwnd)
            .as_deref()
            .and_then(|path| path.file_stem())
            .and_then(|name| name.to_str())
            .unwrap_or("アプリ")
            .to_string()
    }

    #[command]
    pub async fn get_window_icon(hwnd: isize) -> Result<Option<String>, String> {
        tauri::async_runtime::spawn_blocking(move || app_icons::for_window(hwnd))
            .await
            .map_err(|error| format!("アイコン取得処理に失敗しました: {error}"))?
    }

    unsafe extern "system" fn collect_window(hwnd: HWND, context: LPARAM) -> BOOL {
        let windows = unsafe { &mut *(context.0 as *mut Vec<WindowInfo>) };
        let title_length = unsafe { GetWindowTextLengthW(hwnd) };
        let extended_style = unsafe { GetWindowLongW(hwnd, GWL_EXSTYLE) } as u32;
        let owner = unsafe { GetWindow(hwnd, GW_OWNER) };
        if title_length == 0
            || !unsafe { IsWindowVisible(hwnd) }.as_bool()
            || extended_style & WS_EX_TOOLWINDOW.0 != 0
            || owner.is_ok_and(|owner| !owner.0.is_null())
        {
            return BOOL(1);
        }
        let mut title = vec![0u16; title_length as usize + 1];
        let copied = unsafe { GetWindowTextW(hwnd, &mut title) }.max(0) as usize;
        title.truncate(copied);
        let title = String::from_utf16_lossy(&title).trim().to_string();
        if title.is_empty() {
            return BOOL(1);
        }

        let app_name = process_name(hwnd);
        if matches!(
            app_name.as_str(),
            "inter-virtual-desktop"
                | "MinimalShot"
                | "SystemSettings"
                | "ApplicationFrameHost"
                | "TextInputHost"
        ) {
            return BOOL(1);
        }
        let Ok(desktop) = winvd::get_desktop_by_window(hwnd) else {
            return BOOL(1);
        };
        let Ok(desktop_index) = desktop.get_index() else {
            return BOOL(1);
        };
        windows.push(WindowInfo {
            hwnd: hwnd.0 as isize,
            title,
            app_name,
            desktop_index,
            minimized: unsafe { IsIconic(hwnd) }.as_bool(),
            pinned: winvd::is_pinned_window(hwnd).unwrap_or(false),
        });
        BOOL(1)
    }

    fn list_windows() -> Vec<WindowInfo> {
        let mut windows = Vec::<WindowInfo>::new();
        let context = LPARAM(&mut windows as *mut Vec<WindowInfo> as isize);
        let _ = unsafe { EnumWindows(Some(collect_window), context) };
        windows.sort_by(|a, b| {
            a.app_name
                .to_lowercase()
                .cmp(&b.app_name.to_lowercase())
                .then(a.title.to_lowercase().cmp(&b.title.to_lowercase()))
        });
        windows
    }

    #[command]
    pub fn get_snapshot() -> Result<Snapshot, String> {
        let desktops = winvd::get_desktops().map_err(desktop_error)?;
        let current = winvd::get_current_desktop().map_err(desktop_error)?;
        let current_index = current.get_index().map_err(desktop_error)?;
        let desktops = desktops
            .into_iter()
            .map(|desktop| {
                let index = desktop.get_index().map_err(desktop_error)?;
                Ok(DesktopInfo {
                    index,
                    name: desktop.get_name().unwrap_or_default(),
                    current: index == current_index,
                })
            })
            .collect::<Result<Vec<_>, String>>()?;
        Ok(Snapshot {
            desktops,
            windows: list_windows(),
        })
    }

    #[command]
    pub fn create_desktop() -> Result<(), String> {
        winvd::create_desktop().map(|_| ()).map_err(desktop_error)
    }

    #[command]
    pub fn switch_desktop(index: u32) -> Result<(), String> {
        winvd::switch_desktop(index).map_err(desktop_error)
    }

    #[command]
    pub fn remove_desktop(index: u32) -> Result<(), String> {
        let desktops = winvd::get_desktops().map_err(desktop_error)?;
        let current = winvd::get_current_desktop()
            .map_err(desktop_error)?
            .get_index()
            .map_err(desktop_error)?;
        let fallback = desktops
            .iter()
            .find_map(|desktop| {
                desktop
                    .get_index()
                    .ok()
                    .filter(|candidate| *candidate != index)
            })
            .ok_or_else(|| "最後のデスクトップは削除できません。".to_string())?;
        if index == current {
            winvd::remove_desktop(index, fallback).map_err(desktop_error)
        } else {
            winvd::remove_desktop(index, current).map_err(desktop_error)
        }
    }

    #[command]
    pub fn rename_desktop(index: u32, name: String) -> Result<(), String> {
        winvd::get_desktop(index)
            .set_name(&name)
            .map_err(desktop_error)
    }

    #[command]
    pub fn move_window(hwnd: isize, desktop_index: u32) -> Result<(), String> {
        winvd::move_window_to_desktop(desktop_index, &HWND(hwnd as *mut _)).map_err(desktop_error)
    }

    #[command]
    pub fn pin_window(hwnd: isize) -> Result<(), String> {
        winvd::pin_window(HWND(hwnd as *mut _)).map_err(desktop_error)
    }

    #[command]
    pub fn unpin_window(hwnd: isize) -> Result<(), String> {
        winvd::unpin_window(HWND(hwnd as *mut _)).map_err(desktop_error)
    }

    #[command]
    pub fn focus_window(hwnd: isize) -> Result<(), String> {
        super::window_focus::activate(hwnd)
    }

    #[command]
    pub fn close_window(hwnd: isize) -> Result<(), String> {
        unsafe { PostMessageW(HWND(hwnd as *mut _), WM_CLOSE, None, None) }.map_err(desktop_error)
    }
}

#[cfg(not(target_os = "windows"))]
mod platform {
    use super::Snapshot;
    use tauri::command;

    #[command]
    pub async fn get_window_icon(_: isize) -> Result<Option<String>, String> {
        Ok(None)
    }

    #[command]
    pub fn get_snapshot() -> Result<Snapshot, String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn create_desktop() -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn switch_desktop(_: u32) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn remove_desktop(_: u32) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn rename_desktop(_: u32, _: String) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn move_window(_: isize, _: u32) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn pin_window(_: isize) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn unpin_window(_: isize) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn focus_window(_: isize) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
    #[command]
    pub fn close_window(_: isize) -> Result<(), String> {
        Err("Windowsでのみ利用できます。".into())
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    use platform::*;
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .invoke_handler(tauri::generate_handler![
            get_snapshot,
            get_window_icon,
            create_desktop,
            switch_desktop,
            remove_desktop,
            rename_desktop,
            move_window,
            pin_window,
            unpin_window,
            focus_window,
            close_window
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
