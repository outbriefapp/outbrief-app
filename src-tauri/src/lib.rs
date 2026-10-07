#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // The menu bar's app menu reads the bundle's name once, at launch: use the name of the UI
    // language the app last ran in (启奏 in Chinese).
    #[cfg(target_os = "macos")]
    macos::name_app_menu();
    bypass_proxy_for_loopback();
    let builder = tauri::Builder::default();
    // One copy of the app per user: a second one (launched again, or an old build still running)
    // follows the same account on its own and rings every call a second time (YOUT-226). Launching
    // it again shows the running one instead. The plugin must be registered first.
    #[cfg(desktop)]
    let builder = builder.plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
        desktop::show_main_window(app)
    }));
    // In-call Q&A calls the user's OpenAI-compatible endpoint, which sends no CORS headers to
    // the webview; the plugin's fetch goes through Rust instead (scope in capabilities/default.json).
    let builder = builder.plugin(tauri_plugin_http::init());
    // The webview shows no window.confirm: destructive actions ask through the native dialog.
    let builder = builder.plugin(tauri_plugin_dialog::init());
    #[cfg(desktop)]
    let builder = desktop::configure(builder);
    #[cfg(mobile)]
    let builder = builder
        .invoke_handler(tauri::generate_handler![read_daemon_local_key])
        .setup(|app| {
            open_main_window(app.handle())?;
            Ok(())
        });
    builder
        .build(tauri::generate_context!())
        .expect("error while building OutBrief")
        .run(|_app, _event| {
            // macOS: clicking the Dock icon while the window is hidden brings it back.
            #[cfg(target_os = "macos")]
            if let tauri::RunEvent::Reopen { .. } = _event {
                desktop::show_main_window(_app);
            }
        });
}

/// The config window is `create: false` (the desktop setup has to create it after the tray);
/// setup creates it here, visible from the start, on phones too.
fn open_main_window<R: tauri::Runtime>(
    app: &tauri::AppHandle<R>,
) -> tauri::Result<tauri::WebviewWindow<R>> {
    use tauri::Manager;
    if let Some(window) = app.get_webview_window("main") {
        return Ok(window);
    }
    let mut config = app
        .config()
        .app
        .windows
        .iter()
        .find(|window| window.label == "main")
        .cloned()
        .ok_or(tauri::Error::WindowNotFound)?;
    // `tauri dev` serves the UI at build.devUrl (`is_dev` = custom-protocol feature off).
    // A window created here does not get that substitution, so an unset url stays blank.
    if tauri::is_dev() {
        if let Some(dev_url) = app.config().build.dev_url.clone() {
            config.url = tauri::WebviewUrl::External(dev_url);
        }
    }
    // Creating the webview hidden leaves WKWebView blank. Show it as it is created;
    // setup still calls show() for the tray-reopen path.
    config.visible = true;
    tauri::webview::WebviewWindowBuilder::from_config(app, &config)?.build()
}

/// Requests to this machine never go through a proxy. The plugin's fetch (reqwest) picks up the
/// macOS system proxy but not its exceptions list, so with e.g. Surge as system proxy a local LLM
/// endpoint (`http://127.0.0.1:…`) got the proxy's 503 page (YOUT-224). reqwest reads `NO_PROXY`
/// on every fetch; the user's own entries are kept. Runs before any other thread starts.
fn bypass_proxy_for_loopback() {
    let current = ["NO_PROXY", "no_proxy"]
        .iter()
        .find_map(|k| std::env::var(k).ok().filter(|v| !v.trim().is_empty()));
    std::env::set_var("NO_PROXY", with_loopback(current.as_deref()));
}

/// `current` (a `NO_PROXY` list) plus the loopback hosts it lacks.
fn with_loopback(current: Option<&str>) -> String {
    let mut entries: Vec<&str> = current
        .unwrap_or("")
        .split(',')
        .map(str::trim)
        .filter(|e| !e.is_empty())
        .collect();
    for host in ["localhost", "127.0.0.0/8", "::1"] {
        if !entries.iter().any(|e| e.eq_ignore_ascii_case(host)) {
            entries.push(host);
        }
    }
    entries.join(",")
}

/// The key of the local outbrief-daemon's settings API (`$OUTBRIEF_HOME/local-api.key`, default
/// `~/.outbrief`): readable by this user only, so only this machine's app can use that API (it
/// replaced the shared server token, outbrief-server ADR 0008). None on phones, or when no daemon
/// ever ran here.
#[tauri::command]
fn read_daemon_local_key() -> Option<String> {
    #[cfg(desktop)]
    {
        let home = std::env::var_os("OUTBRIEF_HOME")
            .filter(|v| !v.is_empty())
            .map(std::path::PathBuf::from)
            .or_else(|| std::env::var_os("HOME").map(|h| std::path::Path::new(&h).join(".outbrief")))
            .or_else(|| {
                std::env::var_os("USERPROFILE").map(|h| std::path::Path::new(&h).join(".outbrief"))
            })?;
        let key = std::fs::read_to_string(home.join("local-api.key")).ok()?;
        let key = key.trim();
        (!key.is_empty()).then(|| key.to_string())
    }
    #[cfg(mobile)]
    None
}

#[cfg(desktop)]
mod desktop {
    use tauri::menu::{Menu, MenuItem};
    use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
    use tauri::{AppHandle, Builder, Manager, Runtime, State, WebviewWindow, WindowEvent};
    use tauri_plugin_autostart::ManagerExt;

    /// The tray menu entries, kept to rename them when the UI language changes.
    struct TrayItems<R: Runtime> {
        show: MenuItem<R>,
        quit: MenuItem<R>,
    }

    /// The app's names outside the page, in the UI language (sent by the frontend).
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    struct ShellTexts {
        title: String,
        show_window: String,
        quit: String,
        #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
        menu: MenuTexts,
    }

    /// The macOS menu bar: the app menu (named after the app), 编辑 and 窗口.
    #[derive(serde::Deserialize)]
    #[serde(rename_all = "camelCase")]
    #[cfg_attr(not(target_os = "macos"), allow(dead_code))]
    struct MenuTexts {
        about: String,
        services: String,
        hide: String,
        hide_others: String,
        show_all: String,
        quit: String,
        edit: String,
        undo: String,
        redo: String,
        cut: String,
        copy: String,
        paste: String,
        select_all: String,
        window: String,
        minimize: String,
        zoom: String,
        close: String,
    }

    /// Renames the window, the tray tooltip, the tray menu and, on macOS, the menu bar; the texts
    /// live in the frontend. The app menu's own name (启奏 in Chinese) follows on the next launch.
    #[tauri::command]
    fn localize_shell<R: Runtime>(
        app: AppHandle<R>,
        items: State<'_, TrayItems<R>>,
        texts: ShellTexts,
    ) -> tauri::Result<()> {
        main_window(&app)?.set_title(&texts.title)?;
        if let Some(tray) = app.tray_by_id("main") {
            tray.set_tooltip(Some(&texts.title))?;
        }
        items.show.set_text(&texts.show_window)?;
        items.quit.set_text(&texts.quit)?;
        #[cfg(target_os = "macos")]
        {
            super::macos::remember_app_name(&texts.title);
            app.set_menu(menu_bar(&app, &texts.title, &texts.menu)?)?;
        }
        Ok(())
    }

    /// Tauri's default macOS menu bar, minus the empty 文件 / 显示 / 帮助 menus, in the UI language.
    #[cfg(target_os = "macos")]
    fn menu_bar<R: Runtime>(
        app: &AppHandle<R>,
        name: &str,
        texts: &MenuTexts,
    ) -> tauri::Result<Menu<R>> {
        use tauri::menu::{AboutMetadata, PredefinedMenuItem as Item, Submenu, WINDOW_SUBMENU_ID};
        let about = AboutMetadata {
            name: Some(name.to_owned()),
            version: Some(app.package_info().version.to_string()),
            ..Default::default()
        };
        let app_menu = Submenu::with_items(
            app,
            name,
            true,
            &[
                &Item::about(app, Some(&texts.about), Some(about))?,
                &Item::separator(app)?,
                &Item::services(app, Some(&texts.services))?,
                &Item::separator(app)?,
                &Item::hide(app, Some(&texts.hide))?,
                &Item::hide_others(app, Some(&texts.hide_others))?,
                &Item::show_all(app, Some(&texts.show_all))?,
                &Item::separator(app)?,
                &Item::quit(app, Some(&texts.quit))?,
            ],
        )?;
        let edit_menu = Submenu::with_items(
            app,
            &texts.edit,
            true,
            &[
                &Item::undo(app, Some(&texts.undo))?,
                &Item::redo(app, Some(&texts.redo))?,
                &Item::separator(app)?,
                &Item::cut(app, Some(&texts.cut))?,
                &Item::copy(app, Some(&texts.copy))?,
                &Item::paste(app, Some(&texts.paste))?,
                &Item::select_all(app, Some(&texts.select_all))?,
            ],
        )?;
        let window_menu = Submenu::with_id_and_items(
            app,
            WINDOW_SUBMENU_ID,
            &texts.window,
            true,
            &[
                &Item::minimize(app, Some(&texts.minimize))?,
                &Item::maximize(app, Some(&texts.zoom))?,
                &Item::separator(app)?,
                &Item::close_window(app, Some(&texts.close))?,
            ],
        )?;
        Menu::with_items(app, &[&app_menu, &edit_menu, &window_menu])
    }

    /// Tray; closing the window hides it to the tray instead of quitting, so the webview keeps the
    /// event stream open and calls still ring. Launch-at-login was removed: clear a login item an
    /// older build may have registered.
    pub fn configure<R: Runtime>(builder: Builder<R>) -> Builder<R> {
        builder
            .plugin(tauri_plugin_autostart::Builder::new().build())
            .invoke_handler(tauri::generate_handler![localize_shell, super::read_daemon_local_key])
            .setup(|app| {
                setup_tray(app.handle())?;
                let _ = app.autolaunch().disable();
                let window = super::open_main_window(app.handle())?;
                #[cfg(target_os = "linux")]
                super::linux::grant_microphone(&window)?;
                // The window starts hidden (tauri.conf.json) so setup decides when it appears.
                window.show()?;
                Ok(())
            })
            .on_window_event(|window, event| {
                if let WindowEvent::CloseRequested { api, .. } = event {
                    api.prevent_close();
                    let _ = window.hide();
                }
            })
    }

    fn main_window<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<WebviewWindow<R>> {
        app.get_webview_window("main")
            .ok_or(tauri::Error::WindowNotFound)
    }

    pub fn show_main_window<R: Runtime>(app: &AppHandle<R>) {
        if let Ok(window) = main_window(app) {
            let _ = window.unminimize();
            let _ = window.show();
            let _ = window.set_focus();
        }
    }

    fn setup_tray<R: Runtime>(app: &AppHandle<R>) -> tauri::Result<()> {
        // English until the frontend sends the UI language's texts (localize_shell).
        let show = MenuItem::with_id(app, "show", "Show Window", true, None::<&str>)?;
        let quit = MenuItem::with_id(app, "quit", "Quit", true, None::<&str>)?;
        let menu = Menu::with_items(app, &[&show, &quit])?;
        app.manage(TrayItems {
            show: show.clone(),
            quit: quit.clone(),
        });
        let mut tray = TrayIconBuilder::with_id("main")
            .tooltip("OutBrief")
            .menu(&menu)
            .show_menu_on_left_click(false)
            .on_menu_event(|app, event| match event.id().as_ref() {
                "show" => show_main_window(app),
                "quit" => app.exit(0),
                _ => {}
            })
            .on_tray_icon_event(|tray, event| {
                if let TrayIconEvent::Click {
                    button: MouseButton::Left,
                    button_state: MouseButtonState::Up,
                    ..
                } = event
                {
                    show_main_window(tray.app_handle());
                }
            });
        if let Some(icon) = app.default_window_icon() {
            tray = tray.icon(icon.clone());
        }
        tray.build(app)?;
        Ok(())
    }
}

/// macOS shows the app menu under the bundle's `CFBundleName`, read once when the app launches; the
/// menu's own title is ignored. The name of the UI language is kept in the app's user defaults and
/// written into the running bundle's info dictionaries before AppKit reads them (YOUT-210).
#[cfg(target_os = "macos")]
mod macos {
    use objc2::runtime::AnyObject;
    use objc2::{msg_send, sel};
    use objc2_foundation::{ns_string, NSBundle, NSString, NSUserDefaults};

    const APP_NAME_KEY: &str = "OutBriefAppName";

    /// Saves the name for the next launch.
    pub fn remember_app_name(name: &str) {
        let defaults = NSUserDefaults::standardUserDefaults();
        let value = NSString::from_str(name);
        unsafe { defaults.setObject_forKey(Some(&value), &NSString::from_str(APP_NAME_KEY)) };
    }

    /// Before the app launches: names the bundle as the UI language did last time. Without a saved
    /// name the bundle keeps its own (localized by `<lang>.lproj/InfoPlist.strings` when bundled).
    pub fn name_app_menu() {
        let defaults = NSUserDefaults::standardUserDefaults();
        let Some(name) = defaults.stringForKey(&NSString::from_str(APP_NAME_KEY)) else {
            return;
        };
        let bundle = NSBundle::mainBundle();
        let key = ns_string!("CFBundleName");
        for dict in [bundle.infoDictionary(), bundle.localizedInfoDictionary()]
            .into_iter()
            .flatten()
        {
            let dict: &AnyObject = dict.as_ref();
            // The dictionaries are mutable in practice; say so if one is not instead of crashing.
            let mutable: bool =
                unsafe { msg_send![dict, respondsToSelector: sel!(setObject:forKey:)] };
            if mutable {
                let _: () = unsafe { msg_send![dict, setObject: &*name, forKey: key] };
            } else {
                eprintln!(
                    "[outbrief] the bundle's info dictionary is read-only: app menu not renamed"
                );
            }
        }
    }
}

#[cfg(target_os = "linux")]
mod linux {
    use webkit2gtk::glib::prelude::Cast;
    use webkit2gtk::{
        PermissionRequestExt, UserMediaPermissionRequest, UserMediaPermissionRequestExt, WebViewExt,
    };

    /// WebKitGTK denies `getUserMedia` unless the embedder answers `permission-request`: grant
    /// microphone-only requests and leave everything else to WebKit's default.
    pub fn grant_microphone<R: tauri::Runtime>(
        window: &tauri::WebviewWindow<R>,
    ) -> tauri::Result<()> {
        window.with_webview(|webview| {
            webview
                .inner()
                .connect_permission_request(|_, request| {
                    match request.downcast_ref::<UserMediaPermissionRequest>() {
                        Some(media)
                            if media.is_for_audio_device() && !media.is_for_video_device() =>
                        {
                            request.allow();
                            true
                        }
                        _ => false,
                    }
                });
        })
    }
}

#[cfg(test)]
mod tests {
    use super::with_loopback;

    #[test]
    fn loopback_is_added_to_an_empty_list() {
        assert_eq!(with_loopback(None), "localhost,127.0.0.0/8,::1");
    }

    #[test]
    fn the_users_entries_are_kept_and_not_repeated() {
        assert_eq!(
            with_loopback(Some(" corp.example , LOCALHOST,")),
            "corp.example,LOCALHOST,127.0.0.0/8,::1"
        );
    }
}
