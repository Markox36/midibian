pub mod audio;
pub mod midi;
pub mod commands;

use std::sync::Arc;
use tauri::Manager;
use audio::AudioState;
use midi::MidiState;

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Fix for KMS / NVIDIA DRM permission denied errors on Linux:
    // Disabling DMABUF avoids the GBM buffer crash but preserves GPU WebGL acceleration.
    std::env::set_var("WEBKIT_DISABLE_DMABUF_RENDERER", "1");
    
    // Only completely disable Hardware Compositing if falling back via Env Var
    if std::env::var("PIANO_NO_HW_ACCEL").is_ok() {
        std::env::set_var("WEBKIT_DISABLE_COMPOSITING_MODE", "1");
        println!("Hardware acceleration completely disabled via PIANO_NO_HW_ACCEL");
    }
    
    let audio_state = match AudioState::new() {
        Ok(state) => Arc::new(state),
        Err(e) => {
            eprintln!("Failed to initialize audio: {}", e);
            panic!("Cannot continue without audio: {}", e);
        }
    };

    let audio_state_clone = Arc::clone(&audio_state);
    let app_audio_state = Arc::clone(&audio_state);

    tauri::Builder::default()
        .manage(audio_state_clone)
        .manage(MidiState::new())
        .plugin(tauri_plugin_opener::init())
        .setup(move |app| {
            let app_handle = app.handle().clone();
            // Automatically connect to the first available MIDI port as a default
            let ports = midi::get_midi_ports();
            if let Some(first_port) = ports.first() {
                let midi_state = app_handle.state::<MidiState>();
                let _ = midi::connect_midi_port(first_port, app_handle.clone(), app_audio_state.clone(), midi_state.inner());
            }
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::play_note,
            commands::stop_note,
            commands::send_cc,
            commands::change_instrument,
            commands::set_volume,
            commands::list_midi_ports,
            commands::select_midi_port
        ])
        .run(tauri::generate_context!())
        .expect("error while running tauri application");
}
