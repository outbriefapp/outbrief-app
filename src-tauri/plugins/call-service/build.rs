// The commands are Kotlin methods (android/): JS calls them as `plugin:call-service|<command>`.
const COMMANDS: &[&str] = &[
    "configure",
    "set_ringtone",
    "get_status",
    "request_notifications",
    "open_settings",
];

fn main() {
    tauri_plugin::Builder::new(COMMANDS)
        .android_path("android")
        .build();
}
