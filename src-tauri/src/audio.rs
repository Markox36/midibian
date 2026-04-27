use fluidsynth::synth::Synth;
use fluidsynth::settings::Settings;
use fluidsynth::audio::AudioDriver;
use std::path::Path;
use std::sync::{mpsc, Mutex};
use std::thread;

pub enum AudioCommand {
    NoteOn { note: u8, velocity: u8 },
    NoteOff { note: u8 },
    ControlChange { ctrl: u8, value: u8 },
    ProgramChange { program: u8 },
    SetVolume { volume: f32 },
}

pub struct AudioState {
    sender: Mutex<mpsc::Sender<AudioCommand>>,
}

impl AudioState {
    pub fn new() -> Result<Self, String> {
        let (tx, rx) = mpsc::channel::<AudioCommand>();
        
        thread::spawn(move || {
            let mut settings = Settings::new();
            
            // Helpful settings for Linux to prevent audio crackling
            settings.setint("audio.period-size", 1024);
            settings.setint("audio.periods", 8);
            settings.setstr("audio.driver", "pulseaudio");
            
            let mut synth = Synth::new(&mut settings);
            
            let paths_to_try = [
                "default.sf2",
                "/usr/share/sounds/sf2/FluidR3_GM.sf2",
                "/usr/share/soundfonts/default.sf2",
            ];
            
            let mut loaded = false;
            for path in paths_to_try {
                if Path::new(path).exists() {
                    // Option<u32> returned by sfload
                    if synth.sfload(path, 1).is_some() {
                        loaded = true;
                        println!("Successfully loaded SoundFont at {}", path);
                        break;
                    }
                }
            }
            
            if !loaded {
                eprintln!("Warning: No valid SoundFont (.sf2) found. Please place 'default.sf2' in the app directory.");
            }
            
            // Important to keep AudioDriver alive in this thread
            let _adriver = AudioDriver::new(&mut settings, &mut synth);
            
            while let Ok(cmd) = rx.recv() {
                match cmd {
                    AudioCommand::NoteOn { note, velocity } => {
                        let _ = synth.noteon(0, note as i32, velocity as i32);
                    }
                    AudioCommand::NoteOff { note } => {
                        let _ = synth.noteoff(0, note as i32);
                    }
                    AudioCommand::ControlChange { ctrl, value } => {
                        let _ = synth.cc(0, ctrl as i32, value as i32);
                    }
                    AudioCommand::ProgramChange { program } => {
                        let _ = synth.program_change(0, program as i32);
                    }
                    AudioCommand::SetVolume { volume } => {
                        // In fluid-synth bindings, set_gain mostly takes f32
                        synth.set_gain(volume);
                    }
                }
            }
        });
        
        Ok(Self {
            sender: Mutex::new(tx),
        })
    }

    pub fn note_on(&self, note: u8, velocity: u8) {
        if let Ok(sender) = self.sender.lock() {
            let _ = sender.send(AudioCommand::NoteOn { note, velocity });
        }
    }

    pub fn note_off(&self, note: u8) {
        if let Ok(sender) = self.sender.lock() {
            let _ = sender.send(AudioCommand::NoteOff { note });
        }
    }

    pub fn cc(&self, ctrl: u8, value: u8) {
        if let Ok(sender) = self.sender.lock() {
            let _ = sender.send(AudioCommand::ControlChange { ctrl, value });
        }
    }

    pub fn program_change(&self, program: u8) {
        if let Ok(sender) = self.sender.lock() {
            let _ = sender.send(AudioCommand::ProgramChange { program });
        }
    }

    pub fn set_volume(&self, volume: f32) {
        if let Ok(sender) = self.sender.lock() {
            let _ = sender.send(AudioCommand::SetVolume { volume });
        }
    }
}
