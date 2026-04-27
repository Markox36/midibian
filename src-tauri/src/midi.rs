use midir::{MidiInput, MidiInputConnection, Ignore};
use std::sync::{Arc, Mutex};
use tauri::{AppHandle, Emitter};
use serde::Serialize;
use crate::audio::AudioState;

#[derive(Clone, Serialize)]
pub struct MidiEvent {
    pub status: u8,
    pub note: u8,
    pub velocity: u8,
}

pub struct MidiState {
    pub connection: Mutex<Option<MidiInputConnection<()>>>,
}

impl MidiState {
    pub fn new() -> Self {
        Self {
            connection: Mutex::new(None),
        }
    }
}

pub fn get_midi_ports() -> Vec<String> {
    let mut midi_in = match MidiInput::new("Tauri Piano App") {
        Ok(m) => m,
        Err(_) => return vec![],
    };
    midi_in.ignore(Ignore::None);
    let mut ports = vec![];
    for port in midi_in.ports() {
        if let Ok(name) = midi_in.port_name(&port) {
            ports.push(name);
        }
    }
    ports
}

pub fn connect_midi_port(
    port_name: &str,
    app_handle: AppHandle,
    audio_state: Arc<AudioState>,
    midi_state: &MidiState,
) -> Result<(), String> {
    let mut midi_in = MidiInput::new("Tauri Piano App").map_err(|e| e.to_string())?;
    midi_in.ignore(Ignore::None);

    let ports = midi_in.ports();
    let port = ports.into_iter()
        .find(|p| midi_in.port_name(p).unwrap_or_default() == port_name)
        .ok_or_else(|| "Port not found".to_string())?;

    let conn_in = midi_in.connect(&port, "midir-read-callback", move |_stamp, message, _| {
        if message.len() >= 3 {
             let status = message[0];
             let note = message[1];
             let velocity = message[2];
             
             let mut is_note_on = false;
             let mut is_note_off = false;
             
             if (status & 0xF0) == 0x90 {
                 if velocity > 0 {
                     audio_state.note_on(note, velocity);
                     is_note_on = true;
                 } else {
                     audio_state.note_off(note);
                     is_note_off = true;
                 }
             } else if (status & 0xF0) == 0x80 {
                 audio_state.note_off(note);
                 is_note_off = true;
             } else if (status & 0xF0) == 0xB0 {
                 let ctrl = note; // data1 is control number
                 let val = velocity; // data2 is value
                 audio_state.cc(ctrl, val);
                 
                 let event = MidiEvent {
                     status: 2, // 2 indicates CC message
                     note: ctrl,
                     velocity: val,
                 };
                 let _ = app_handle.emit("midi-event", event);
             } else if (status & 0xF0) == 0xC0 {
                 let program = note; // data1 is program number
                 audio_state.program_change(program);
                 
                 let event = MidiEvent {
                     status: 3, // 3 indicates Program Change
                     note: program,
                     velocity: 0,
                 };
                 let _ = app_handle.emit("midi-event", event);
             }
             
             if is_note_on || is_note_off {
                 let ev_status = if is_note_on { 1 } else { 0 };
                 let event = MidiEvent {
                     status: ev_status,
                     note,
                     velocity,
                 };
                 let _ = app_handle.emit("midi-event", event);
             }
        }
    }, ()).map_err(|e| e.to_string())?;

    let mut conn = midi_state.connection.lock().unwrap();
    *conn = Some(conn_in);

    Ok(())
}
