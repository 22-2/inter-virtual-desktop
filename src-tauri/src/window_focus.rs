use windows::Win32::{
    Foundation::HWND,
    UI::WindowsAndMessaging::{
        GetLastActivePopup, IsIconic, IsWindow, IsWindowVisible, SW_RESTORE, SetForegroundWindow,
        ShowWindowAsync,
    },
};

pub(super) fn activate(hwnd: isize) -> Result<(), String> {
    let hwnd = HWND(hwnd as *mut _);
    if !unsafe { IsWindow(hwnd) }.as_bool() {
        return Err("対象のウィンドウは既に閉じられています。".into());
    }

    if !winvd::is_window_on_current_desktop(hwnd)
        .map_err(|error| format!("ウィンドウのデスクトップを確認できません: {error:?}"))?
    {
        let desktop = winvd::get_desktop_by_window(hwnd)
            .map_err(|error| format!("移動先のデスクトップを取得できません: {error:?}"))?;
        winvd::switch_desktop(desktop)
            .map_err(|error| format!("デスクトップを切り替えられません: {error:?}"))?;
    }

    if unsafe { IsIconic(hwnd) }.as_bool()
        && !unsafe { ShowWindowAsync(hwnd, SW_RESTORE) }.as_bool()
    {
        return Err("最小化されたウィンドウを復元できません。".into());
    }

    // 確認ダイアログなどが開いている場合は、操作可能なポップアップへフォーカスする。
    let popup = unsafe { GetLastActivePopup(hwnd) };
    let target = if unsafe { IsWindowVisible(popup) }.as_bool() {
        popup
    } else {
        hwnd
    };
    if !unsafe { SetForegroundWindow(target) }.as_bool() {
        return Err("Windowsによってウィンドウの前面表示が拒否されました。".into());
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    #[test]
    fn closed_window_returns_an_error_before_desktop_operations() {
        assert_eq!(
            super::activate(0).unwrap_err(),
            "対象のウィンドウは既に閉じられています。"
        );
    }
}
