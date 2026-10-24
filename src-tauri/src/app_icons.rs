use base64::{Engine, engine::general_purpose::STANDARD};
use std::{
    collections::HashMap,
    ffi::{OsString, c_void},
    mem::size_of,
    os::windows::ffi::{OsStrExt, OsStringExt},
    path::{Path, PathBuf},
    sync::{Mutex, OnceLock},
};
use windows::{
    Win32::{
        Foundation::{CloseHandle, HWND, RPC_E_CHANGED_MODE},
        Graphics::Gdi::{
            BI_RGB, BITMAPINFO, BITMAPINFOHEADER, CreateCompatibleDC, CreateDIBSection,
            DIB_RGB_COLORS, DeleteDC, DeleteObject, GdiFlush, HBITMAP, HBRUSH, HDC, HGDIOBJ,
            SelectObject,
        },
        Storage::FileSystem::FILE_FLAGS_AND_ATTRIBUTES,
        System::{
            Com::{COINIT_APARTMENTTHREADED, CoInitializeEx, CoUninitialize},
            Threading::{
                OpenProcess, PROCESS_NAME_FORMAT, PROCESS_QUERY_LIMITED_INFORMATION,
                QueryFullProcessImageNameW,
            },
        },
        UI::{
            Shell::{SHFILEINFOW, SHGFI_ICON, SHGFI_LARGEICON, SHGetFileInfoW},
            WindowsAndMessaging::{
                DI_MASK, DI_NORMAL, DestroyIcon, DrawIconEx, GetWindowThreadProcessId, HICON,
            },
        },
    },
    core::{PCWSTR, PWSTR},
};

const ICON_SIZE: usize = 32;
static ICON_CACHE: OnceLock<Mutex<HashMap<PathBuf, Option<String>>>> = OnceLock::new();

pub(super) fn process_path(hwnd: HWND) -> Option<PathBuf> {
    let mut process_id = 0;
    unsafe { GetWindowThreadProcessId(hwnd, Some(&mut process_id)) };
    let process =
        unsafe { OpenProcess(PROCESS_QUERY_LIMITED_INFORMATION, false, process_id) }.ok()?;
    let mut buffer = vec![0u16; 32768];
    let mut length = buffer.len() as u32;
    let result = unsafe {
        QueryFullProcessImageNameW(
            process,
            PROCESS_NAME_FORMAT(0),
            PWSTR(buffer.as_mut_ptr()),
            &mut length,
        )
    };
    // 一覧更新でも呼ぶため、取得の成否によらずプロセスハンドルを解放する。
    let _ = unsafe { CloseHandle(process) };
    result.ok()?;
    Some(PathBuf::from(OsString::from_wide(
        &buffer[..length as usize],
    )))
}

pub(super) fn for_window(hwnd: isize) -> Result<Option<String>, String> {
    let Some(path) = process_path(HWND(hwnd as *mut _)) else {
        return Ok(None);
    };
    let mut cache = ICON_CACHE
        .get_or_init(|| Mutex::new(HashMap::new()))
        .lock()
        .map_err(|error| format!("アイコンキャッシュにアクセスできません: {error}"))?;
    if let Some(icon) = cache.get(&path) {
        return Ok(icon.clone());
    }
    let icon = file_icon(&path);
    cache.insert(path, icon.clone());
    Ok(icon)
}

struct ComApartment(bool);

impl ComApartment {
    fn initialize() -> Option<Self> {
        let result = unsafe { CoInitializeEx(None, COINIT_APARTMENTTHREADED) };
        if result.is_ok() {
            Some(Self(true))
        } else if result == RPC_E_CHANGED_MODE {
            // ワーカースレッドが別のCOMアパートメントで初期化済みなら、そのまま使う。
            Some(Self(false))
        } else {
            None
        }
    }
}

impl Drop for ComApartment {
    fn drop(&mut self) {
        if self.0 {
            unsafe { CoUninitialize() };
        }
    }
}

struct OwnedIcon(HICON);

impl Drop for OwnedIcon {
    fn drop(&mut self) {
        let _ = unsafe { DestroyIcon(self.0) };
    }
}

fn file_icon(path: &Path) -> Option<String> {
    let _com = ComApartment::initialize()?;
    let path: Vec<u16> = path.as_os_str().encode_wide().chain(Some(0)).collect();
    let mut info = SHFILEINFOW::default();
    let result = unsafe {
        SHGetFileInfoW(
            PCWSTR(path.as_ptr()),
            FILE_FLAGS_AND_ATTRIBUTES(0),
            Some(&mut info),
            size_of::<SHFILEINFOW>() as u32,
            SHGFI_ICON | SHGFI_LARGEICON,
        )
    };
    if result == 0 || info.hIcon.0.is_null() {
        return None;
    }
    let icon = OwnedIcon(info.hIcon);
    let png = icon_png(icon.0)?;
    Some(format!("data:image/png;base64,{}", STANDARD.encode(png)))
}

struct IconSurface {
    dc: HDC,
    bitmap: HBITMAP,
    previous: HGDIOBJ,
    bits: *mut c_void,
}

impl IconSurface {
    fn new() -> Option<Self> {
        let dc = unsafe { CreateCompatibleDC(None) };
        if dc.0.is_null() {
            return None;
        }
        let info = BITMAPINFO {
            bmiHeader: BITMAPINFOHEADER {
                biSize: size_of::<BITMAPINFOHEADER>() as u32,
                biWidth: ICON_SIZE as i32,
                biHeight: -(ICON_SIZE as i32),
                biPlanes: 1,
                biBitCount: 32,
                biCompression: BI_RGB.0,
                ..Default::default()
            },
            ..Default::default()
        };
        let mut bits = std::ptr::null_mut();
        let bitmap =
            match unsafe { CreateDIBSection(dc, &info, DIB_RGB_COLORS, &mut bits, None, 0) } {
                Ok(bitmap) => bitmap,
                Err(_) => {
                    let _ = unsafe { DeleteDC(dc) };
                    return None;
                }
            };
        let previous = unsafe { SelectObject(dc, HGDIOBJ(bitmap.0)) };
        let surface = Self {
            dc,
            bitmap,
            previous,
            bits,
        };
        if bits.is_null() || previous.0.is_null() || previous.0 as isize == -1 {
            return None;
        }
        Some(surface)
    }

    fn pixels(&mut self) -> &mut [u8] {
        // 生存中のDIBの32bpp領域のみ参照し、GDI描画中はこの借用を保持しない。
        unsafe { std::slice::from_raw_parts_mut(self.bits.cast::<u8>(), ICON_SIZE * ICON_SIZE * 4) }
    }
}

impl Drop for IconSurface {
    fn drop(&mut self) {
        unsafe {
            SelectObject(self.dc, self.previous);
            let _ = DeleteObject(HGDIOBJ(self.bitmap.0));
            let _ = DeleteDC(self.dc);
        }
    }
}

fn icon_png(icon: HICON) -> Option<Vec<u8>> {
    let mut surface = IconSurface::new()?;
    surface.pixels().fill(0);
    unsafe {
        DrawIconEx(
            surface.dc,
            0,
            0,
            icon,
            ICON_SIZE as i32,
            ICON_SIZE as i32,
            0,
            HBRUSH::default(),
            DI_NORMAL,
        )
        .ok()?;
        if !GdiFlush().as_bool() {
            return None;
        }
    }
    let mut rgba = surface.pixels().to_vec();
    if !rgba.as_chunks::<4>().0.iter().any(|pixel| pixel[3] != 0) {
        // 古いアイコンはアルファ値を持たないため、ANDマスクから透明度を補う。
        surface.pixels().fill(0);
        unsafe {
            DrawIconEx(
                surface.dc,
                0,
                0,
                icon,
                ICON_SIZE as i32,
                ICON_SIZE as i32,
                0,
                HBRUSH::default(),
                DI_MASK,
            )
            .ok()?;
            if !GdiFlush().as_bool() {
                return None;
            }
        }
        for (pixel, mask) in rgba
            .as_chunks_mut::<4>()
            .0
            .iter_mut()
            .zip(surface.pixels().as_chunks::<4>().0.iter())
        {
            pixel[3] = if mask[0] == 0 { 255 } else { 0 };
        }
    }
    for pixel in rgba.as_chunks_mut::<4>().0 {
        pixel.swap(0, 2);
        // GDIの乗算済みBGRAを、PNGの非乗算RGBAへ変換する。
        let alpha = u32::from(pixel[3]);
        for channel in &mut pixel[..3] {
            *channel = (u32::from(*channel) * 255 + alpha / 2)
                .checked_div(alpha)
                .unwrap_or(0)
                .min(255) as u8;
        }
    }
    let mut data = Vec::new();
    {
        let mut encoder = png::Encoder::new(&mut data, ICON_SIZE as u32, ICON_SIZE as u32);
        encoder.set_color(png::ColorType::Rgba);
        encoder.set_depth(png::BitDepth::Eight);
        let mut writer = encoder.write_header().ok()?;
        writer.write_image_data(&rgba).ok()?;
        writer.finish().ok()?;
    }
    Some(data)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;
    use windows::Win32::UI::WindowsAndMessaging::{IDI_APPLICATION, IDI_INFORMATION, LoadIconW};

    fn assert_png(data: &[u8]) {
        let mut reader = png::Decoder::new(Cursor::new(data)).read_info().unwrap();
        let mut pixels = vec![0; reader.output_buffer_size().unwrap()];
        let frame = reader.next_frame(&mut pixels).unwrap();
        assert_eq!(
            (frame.width, frame.height),
            (ICON_SIZE as u32, ICON_SIZE as u32)
        );
        assert_eq!(frame.color_type, png::ColorType::Rgba);
        assert!(pixels.as_chunks::<4>().0.iter().any(|pixel| pixel[3] > 0));
        assert!(pixels.as_chunks::<4>().0.iter().any(|pixel| pixel[3] == 0));
    }

    #[test]
    fn system_icons_preserve_transparency_in_png() {
        for resource in [IDI_APPLICATION, IDI_INFORMATION] {
            // LoadIconの共有ハンドルは所有しないため、DestroyIconは呼ばない。
            let icon = unsafe { LoadIconW(None, resource) }.unwrap();
            assert_png(&icon_png(icon).unwrap());
        }
    }

    #[test]
    fn executable_icon_is_encoded_as_png_data_url() {
        let windows_dir = PathBuf::from(std::env::var_os("WINDIR").unwrap());
        let source = file_icon(&windows_dir.join("explorer.exe")).unwrap();
        let encoded = source.strip_prefix("data:image/png;base64,").unwrap();
        assert_png(&STANDARD.decode(encoded).unwrap());
    }

    #[test]
    fn unavailable_window_uses_the_default_icon() {
        assert_eq!(for_window(0).unwrap(), None);
    }
}
