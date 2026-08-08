use tauri::State;
use std::sync::Arc;
use crate::audio::AudioState;
use crate::midi::MidiState;

#[tauri::command]
pub fn play_note(note: u8, velocity: u8, state: State<'_, Arc<AudioState>>) {
    state.note_on(note, velocity);
}

#[tauri::command]
pub fn stop_note(note: u8, state: State<'_, Arc<AudioState>>) {
    state.note_off(note);
}

#[tauri::command]
pub fn send_cc(ctrl: u8, value: u8, state: State<'_, Arc<AudioState>>) {
    state.cc(ctrl, value);
}

#[tauri::command]
pub fn change_instrument(program: u8, state: State<'_, Arc<AudioState>>) {
    state.program_change(program);
}

#[tauri::command]
pub fn set_volume(volume: f32, state: State<'_, Arc<AudioState>>) {
    state.set_volume(volume);
}

#[tauri::command]
pub fn list_midi_ports() -> Vec<String> {
    crate::midi::get_midi_ports()
}

#[tauri::command]
pub fn diag_log(msg: String) {
    println!("[DIAG] {}", msg);
}

#[tauri::command]
pub fn select_midi_port(
    port_name: String,
    app_handle: tauri::AppHandle,
    audio_state: State<'_, Arc<AudioState>>,
    midi_state: State<'_, MidiState>,
) -> Result<(), String> {
    crate::midi::connect_midi_port(&port_name, app_handle, audio_state.inner().clone(), midi_state.inner())
}
