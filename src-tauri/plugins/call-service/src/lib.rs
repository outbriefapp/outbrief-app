//! Calls keep ringing on Android while the app is in the background or the phone is locked
//! (OUTB-60): a foreground service follows the account's event stream natively and rings a call
//! as a full-screen notification. The work is in Kotlin (`android/`); elsewhere this plugin does
//! nothing and the page never calls it.

use tauri::{
    plugin::{Builder, TauriPlugin},
    Runtime,
};

pub fn init<R: Runtime>() -> TauriPlugin<R> {
    Builder::new("call-service")
        .setup(|_app, _api| {
            #[cfg(target_os = "android")]
            _api.register_android_plugin("ai.outbrief.callservice", "CallServicePlugin")?;
            Ok(())
        })
        .build()
}
