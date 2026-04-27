const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let keyboardDiv;

const START_NOTE = 21; // A0
const TOTAL_KEYS = 88;
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const keyElements = new Map();
const activeNotes = new Set();
const backendNotes = new Set();

// Synthesia Track
const trackNotes = [];
const activeTrackNotes = new Map();
let lastTime = 0;

class TrackNote {
    constructor(midiNote, timeCreated) {
        this.midiNote = midiNote;
        this.timeCreated = timeCreated;
        this.timeReleased = null;
        this.active = true;
    }
}

const noteDimensions = {};
let currentWhiteIndex = 0;

for (let i = 0; i < TOTAL_KEYS; i++) {
    const midiNote = START_NOTE + i;
    const isBlack = NOTES[midiNote % 12].includes("#");
    if (!isBlack) {
        noteDimensions[midiNote] = { isBlack: false, whiteIndex: currentWhiteIndex };
        currentWhiteIndex++;
    }
}
for (let i = 0; i < TOTAL_KEYS; i++) {
    const midiNote = START_NOTE + i;
    const isBlack = NOTES[midiNote % 12].includes("#");
    if (isBlack) {
        // Place precisely between prev and next white note.
        const prevWhite = noteDimensions[midiNote - 1];
        noteDimensions[midiNote] = { isBlack: true, whiteIndex: prevWhite.whiteIndex };
    }
}

function getNotePosition(midiNote, totalWidth) {
    const dim = noteDimensions[midiNote];
    const whiteWidth = totalWidth / 52;
    if (dim.isBlack) {
        const blackWidth = whiteWidth * 0.65;
        const x = (dim.whiteIndex + 1) * whiteWidth - (blackWidth / 2);
        return { isBlack: true, x, w: blackWidth };
    } else {
        return { isBlack: false, x: dim.whiteIndex * whiteWidth, w: whiteWidth };
    }
}

function getNoteName(midiNote) {
    const octave = Math.floor(midiNote / 12) - 1;
    const noteName = NOTES[midiNote % 12];
    return `${noteName}${octave}`;
}

function createKeyboard() {
    keyboardDiv = document.getElementById("keyboard");
    keyboardDiv.innerHTML = '';
    
    for (let i = 0; i < TOTAL_KEYS; i++) {
        const midiNote = START_NOTE + i;
        const noteName = getNoteName(midiNote);
        const pos = getNotePosition(midiNote, 100);
        
        const keyEl = document.createElement("div");
        keyEl.className = `key ${pos.isBlack ? "black" : "white"}`;
        keyEl.dataset.note = noteName;
        
        keyEl.style.left = `${pos.x}%`;
        keyEl.style.width = `${pos.w}%`;
        
        const handleDown = (e) => {
            e.preventDefault();
            triggerNoteOn(midiNote, 100);
        };
        const handleUp = (e) => {
            e.preventDefault();
            triggerNoteOff(midiNote);
        };

        keyEl.addEventListener("mousedown", handleDown);
        keyEl.addEventListener("mouseup", handleUp);
        keyEl.addEventListener("mouseleave", () => {
             if (activeNotes.has(midiNote)) {
                 triggerNoteOff(midiNote);
             }
        });

        keyEl.addEventListener("touchstart", handleDown, {passive: false});
        keyEl.addEventListener("touchend", handleUp, {passive: false});
        keyEl.addEventListener("touchcancel", handleUp, {passive: false});

        keyboardDiv.appendChild(keyEl);
        keyElements.set(midiNote, keyEl);
    }
}

async function triggerNoteOn(midiNote, velocity) {
    if (activeNotes.has(midiNote)) return;
    activeNotes.add(midiNote);
    
    const el = keyElements.get(midiNote);
    if (el) el.classList.add("active");

    if (visualMode > 0) {
        const tn = new TrackNote(midiNote, performance.now());
        trackNotes.push(tn);
        activeTrackNotes.set(midiNote, tn);
    }

    await invoke("play_note", { note: midiNote, velocity });
}

async function triggerNoteOff(midiNote) {
    if (!activeNotes.has(midiNote)) return;
    activeNotes.delete(midiNote);
    
    const el = keyElements.get(midiNote);
    if (el && !backendNotes.has(midiNote)) el.classList.remove("active");

    const tn = activeTrackNotes.get(midiNote);
    if (tn) {
        tn.active = false;
        tn.timeReleased = performance.now();
        activeTrackNotes.delete(midiNote);
    }

    await invoke("stop_note", { note: midiNote });
}

const KEYMAP = {
    'z': 60, 's': 61, 'x': 62, 'd': 63, 'c': 64, 'v': 65, 'g': 66, 'b': 67, 'h': 68, 'n': 69, 'j': 70, 'm': 71, ',': 72,
    'q': 72, '2': 73, 'w': 74, '3': 75, 'e': 76, 'r': 77, '5': 78, 't': 79, '6': 80, 'y': 81, '7': 82, 'u': 83, 'i': 84,
};

let sustainPedalDown = false;

window.addEventListener("keydown", (e) => {
    if (e.repeat) return;
    if (e.code === 'Space') {
        sustainPedalDown = true;
        const pedalEl = document.getElementById('sustain-pedal');
        if (pedalEl) pedalEl.classList.add('active');
        invoke("send_cc", { ctrl: 64, value: 127 });
        e.preventDefault();
        return;
    }
    const midiNote = KEYMAP[e.key.toLowerCase()];
    if (midiNote) triggerNoteOn(midiNote, 100);
});

window.addEventListener("keyup", (e) => {
    if (e.code === 'Space') {
        sustainPedalDown = false;
        const pedalEl = document.getElementById('sustain-pedal');
        if (pedalEl) pedalEl.classList.remove('active');
        invoke("send_cc", { ctrl: 64, value: 0 });
        e.preventDefault();
        return;
    }
    const midiNote = KEYMAP[e.key.toLowerCase()];
    if (midiNote) triggerNoteOff(midiNote);
});

async function setupMidiListener() {
    await listen('midi-event', (event) => {
        const { status, note, velocity } = event.payload;
        if (status === 1) {
            backendNotes.add(note);
            const el = keyElements.get(note);
            if (el) el.classList.add("active");
            
            if (visualMode > 0 && !activeTrackNotes.has(note)) {
                const tn = new TrackNote(note, performance.now());
                trackNotes.push(tn);
                activeTrackNotes.set(note, tn);
            }
        } else if (status === 0) {
            backendNotes.delete(note);
            const el = keyElements.get(note);
            if (el && !activeNotes.has(note)) el.classList.remove("active");
            
            const tn = activeTrackNotes.get(note);
            if (tn && !activeNotes.has(note)) {
                tn.active = false;
                tn.timeReleased = performance.now();
                activeTrackNotes.delete(note);
            }
        } else if (status === 2 && note === 64) {
            const pedalEl = document.getElementById('sustain-pedal');
            if (velocity >= 64) {
                if (pedalEl) pedalEl.classList.add('active');
            } else {
                if (pedalEl) pedalEl.classList.remove('active');
            }
        } else if (status === 3) {
            const sel = document.getElementById('instrument-select');
            if (sel) sel.value = note;
        }
    });
}

// WebGL ThreeJS visualizer variables
let visualMode = 2; // 2 = 3D FX, 1 = 2D FX, 0 = OFF
let scene, camera, renderer, notesMesh, gridMesh;
let noteMaterial3D, noteMaterial2D;
const MAX_NOTES = 1000;
const dummy = new THREE.Object3D();

let particlesMesh;
const MAX_PARTICLES = 500; // Optimized from 1500
const particlePos = new Float32Array(MAX_PARTICLES * 3);
const particleVel = new Float32Array(MAX_PARTICLES * 3);
const particleLife = new Float32Array(MAX_PARTICLES);
const particleColor = new Float32Array(MAX_PARTICLES * 3);
let particleIndex = 0;

function emitParticle(x, y, r, g, b, count) {
    for (let i = 0; i < count; i++) {
        particlePos[particleIndex * 3] = x + (Math.random() - 0.5) * 1.5;
        particlePos[particleIndex * 3 + 1] = y + (Math.random() - 0.5) * 1.5;
        particlePos[particleIndex * 3 + 2] = 2; // in front of notes

        particleVel[particleIndex * 3] = (Math.random() - 0.5) * 0.5;
        particleVel[particleIndex * 3 + 1] = (Math.random() - 0.5) * 0.5 - 0.1;
        particleVel[particleIndex * 3 + 2] = 0;

        particleLife[particleIndex] = 1.0 + Math.random() * 0.4;

        particleColor[particleIndex * 3] = r * 1.2;
        particleColor[particleIndex * 3 + 1] = g * 1.2;
        particleColor[particleIndex * 3 + 2] = b * 1.2;

        particleIndex = (particleIndex + 1) % MAX_PARTICLES;
    }
}

function initThreeJS() {
    const container = document.querySelector('.track-container');
    container.innerHTML = '';
    
    scene = new THREE.Scene();
    
    const aspect = container.clientWidth / container.clientHeight;
    // Map width3D strictly to 100
    const width3D = 100;
    
    camera = new THREE.OrthographicCamera(
        -width3D / 2, width3D / 2, 
        width3D / aspect, 0, 
        0.1, 1000
    );
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);
    
    renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(container.clientWidth, container.clientHeight);
    renderer.setPixelRatio(window.devicePixelRatio);
    container.appendChild(renderer.domElement);
    
    noteMaterial3D = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
            varying vec3 vColor;
            varying vec2 vUv;
            void main() {
                vColor = instanceColor;
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying vec2 vUv;
            uniform float time;
            void main() {
                float horizGlow = 1.0 - abs(vUv.x - 0.5) * 2.0;
                float core = smoothstep(0.6, 1.0, horizGlow);
                
                vec3 baseColor = vColor * (0.6 + horizGlow * 2.0);
                vec3 finalColor = mix(baseColor, vec3(1.0), core * 0.9);
                
                float pulse = sin(time * 15.0 + vColor.r * 10.0) * 0.5 + 0.5;
                float headGlow = smoothstep(0.85, 1.0, vUv.y) * (0.5 + pulse * 1.5);
                finalColor += finalColor * headGlow * 1.5;
                
                float vertAlpha = smoothstep(1.0, 0.9, vUv.y) * smoothstep(0.0, 0.05, vUv.y);
                
                gl_FragColor = vec4(finalColor, vertAlpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    noteMaterial2D = new THREE.ShaderMaterial({
        vertexShader: `
            varying vec3 vColor;
            void main() {
                vColor = instanceColor;
                gl_Position = projectionMatrix * modelViewMatrix * instanceMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            void main() {
                gl_FragColor = vec4(vColor, 0.95);
            }
        `,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false
    });
    
    const geometry = new THREE.PlaneGeometry(1, 1);
    // Move origin to bottom center so scaling only goes up!
    geometry.translate(0, 0.5, 0); 
    
    notesMesh = new THREE.InstancedMesh(geometry, noteMaterial3D, MAX_NOTES);
    notesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    
    // Explicitly initialize instanceColor to avoid WebGL crash on first render
    const colorArray = new Float32Array(MAX_NOTES * 3);
    const colorAttr = new THREE.InstancedBufferAttribute(colorArray, 3);
    notesMesh.instanceColor = colorAttr;
    notesMesh.geometry.setAttribute('instanceColor', colorAttr);
    
    scene.add(notesMesh);
    
    // Modern Grid Shader for Background (Octave Guides)
    const gridMat = new THREE.ShaderMaterial({
        uniforms: { time: { value: 0 } },
        vertexShader: `
            varying vec2 vUv;
            void main() {
                vUv = uv;
                gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
            }
        `,
        fragmentShader: `
            varying vec2 vUv;
            void main() {
                // Total white keys = 52. 
                // A0 is index 0. C1 starts exactly at index 2.0, C2 at 9.0...
                // So lines are at (vUv.x * 52.0 - 2.0) % 7 == 0
                float val = (vUv.x * 52.0 - 2.0) / 7.0;
                float lineVal = abs(fract(val) - 0.5) * 2.0;
                
                // Very sharp line
                float edgeX = smoothstep(0.97, 1.0, lineVal);
                
                vec3 bg = vec3(0.11, 0.11, 0.12); // #1c1c1e equivalent
                vec3 lineCol = vec3(0.22, 0.22, 0.23); // #38383a
                vec3 col = mix(bg, lineCol, edgeX);
                
                // Deep vertical fade
                float fade = smoothstep(1.0, 0.1, vUv.y);
                
                gl_FragColor = vec4(col, fade);
            }
        `,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false
    });
    
    // Giant plane covering exactly the screen width 100, height huge
    const gridGeometry = new THREE.PlaneGeometry(100, 300);
    // Origin bottom center
    gridGeometry.translate(0, 150, 0);
    
    gridMesh = new THREE.Mesh(gridGeometry, gridMat);
    gridMesh.position.set(0, 0, -10);
    scene.add(gridMesh);

    const pointsGeo = new THREE.BufferGeometry();
    pointsGeo.setAttribute('position', new THREE.BufferAttribute(particlePos, 3));
    pointsGeo.setAttribute('customColor', new THREE.BufferAttribute(particleColor, 3));
    pointsGeo.setAttribute('life', new THREE.BufferAttribute(particleLife, 1));
    const pointsMat = new THREE.ShaderMaterial({
        vertexShader: `
            attribute vec3 customColor;
            attribute float life;
            varying vec3 vColor;
            varying float vLife;
            void main() {
                vColor = customColor;
                vLife = life;
                vec4 mvPosition = modelViewMatrix * vec4(position, 1.0);
                gl_PointSize = max(vLife * 6.0 * (100.0 / -mvPosition.z), 1.0);
                gl_Position = projectionMatrix * mvPosition;
            }
        `,
        fragmentShader: `
            varying vec3 vColor;
            varying float vLife;
            void main() {
                float r = distance(gl_PointCoord, vec2(0.5));
                if (r > 0.5 || vLife <= 0.0) discard;
                float alpha = (1.0 - r * 2.0) * vLife;
                gl_FragColor = vec4(vColor, alpha);
            }
        `,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });
    particlesMesh = new THREE.Points(pointsGeo, pointsMat);
    scene.add(particlesMesh);

    window.addEventListener('resize', () => {
        const aspect = container.clientWidth / container.clientHeight;
        camera.top = width3D / aspect;
        camera.updateProjectionMatrix();
        renderer.setSize(container.clientWidth, container.clientHeight);
    });
}

function animate(time) {
    if (!lastTime) lastTime = time;
    if (!renderer) {
        requestAnimationFrame(animate);
        return;
    }
    
    if (visualMode === 0) {
        // Just loop without doing heavy ThreeJS work
        lastTime = time;
        requestAnimationFrame(animate);
        return;
    }
    
    const is3D = visualMode === 2;
    notesMesh.material = is3D ? noteMaterial3D : noteMaterial2D;
    particlesMesh.visible = is3D;
    
    const speed = 0.025; // 2.5x slower
    
    const colorObj = new THREE.Color();
    
    let whiteCount = 0;
    for (let i = 0; i < trackNotes.length; i++) {
        if (!window.getNotePosition(trackNotes[i].midiNote, 100).isBlack) {
            whiteCount++;
        }
    }
    
    let wIdx = 0;
    let bIdx = whiteCount;
    let actualInstances = trackNotes.length;
    if (actualInstances > MAX_NOTES) actualInstances = MAX_NOTES;
    
    for (let i = trackNotes.length - 1; i >= 0; i--) {
        const noteObj = trackNotes[i];
        
        const posPercent = window.getNotePosition(noteObj.midiNote, 100);
        const xPos = -50 + posPercent.x;
        const width = posPercent.w;
        
        const timeActive = time - noteObj.timeCreated;
        let headY = timeActive * speed;
        
        let tailY = 0;
        if (!noteObj.active) {
            const timeSinceReleased = time - noteObj.timeReleased;
            tailY = timeSinceReleased * speed;
        }
        
        const height = headY - tailY;
        
        dummy.position.set(xPos + width/2, tailY, 0);
        dummy.scale.set(width * 0.85, height, 1.0);
        dummy.updateMatrix();
        
        const isBright = noteObj.active;
        const hexColor = posPercent.isBlack ? 0xd946ef : 0x3b82f6; 
        colorObj.setHex(isBright ? (posPercent.isBlack ? 0xf472b6 : 0x60a5fa) : hexColor);
        
        let targetIdx = posPercent.isBlack ? bIdx++ : wIdx++;
        if (targetIdx < MAX_NOTES) {
            notesMesh.setMatrixAt(targetIdx, dummy.matrix);
            notesMesh.setColorAt(targetIdx, colorObj);
        }
        
        if (is3D && isBright && Math.random() > 0.4) {
            emitParticle(xPos + width/2, headY, colorObj.r, colorObj.g, colorObj.b, 1); 
            if (Math.random() > 0.7) emitParticle(xPos + width/2, 0, colorObj.r, colorObj.g, colorObj.b, 1);     
        }
        
        // Logical max height cleanup
        if (tailY > 300) {
            trackNotes.splice(i, 1);
        }
    }
    
    notesMesh.count = Math.min(bIdx, MAX_NOTES);
    notesMesh.instanceMatrix.needsUpdate = true;
    if (notesMesh.instanceColor) notesMesh.instanceColor.needsUpdate = true;
    
    if (is3D) {
        const positions = particlesMesh.geometry.attributes.position.array;
        const lifes = particlesMesh.geometry.attributes.life.array;
        let activeParticles = false;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (lifes[i] > 0) {
                lifes[i] -= 0.02;
                positions[i * 3] += particleVel[i * 3];
                positions[i * 3 + 1] += particleVel[i * 3 + 1];
                particleVel[i * 3 + 1] -= 0.008; // Gravity
                activeParticles = true;
            } else if (lifes[i] > -1) {
                positions[i*3] = -999;
                lifes[i] = -2;
                activeParticles = true; 
            }
        }
        if (activeParticles) {
            particlesMesh.geometry.attributes.position.needsUpdate = true;
            particlesMesh.geometry.attributes.life.needsUpdate = true;
            particlesMesh.geometry.attributes.customColor.needsUpdate = true;
        }
    }
    
    if (is3D) {
        notesMesh.material.uniforms.time.value = time * 0.001;
    }
    gridMesh.material.uniforms.time.value = time * 0.001;
    
    renderer.render(scene, camera);
    lastTime = time;
    requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", () => {
    // Expose layout calculation for logic elsewhere if needed
    window.getNotePosition = getNotePosition;
    
    createKeyboard();
    setupMidiListener();
    initThreeJS();
    requestAnimationFrame(animate);
    
    const pedalEl = document.getElementById('sustain-pedal');
    if (pedalEl) {
        pedalEl.addEventListener("mousedown", () => {
            pedalEl.classList.add('active');
            invoke("send_cc", { ctrl: 64, value: 127 });
        });
        pedalEl.addEventListener("mouseup", () => {
             pedalEl.classList.remove('active');
             invoke("send_cc", { ctrl: 64, value: 0 });
        });
        pedalEl.addEventListener("mouseleave", () => {
             pedalEl.classList.remove('active');
             invoke("send_cc", { ctrl: 64, value: 0 });
        });
        pedalEl.addEventListener("touchstart", (e) => {
            e.preventDefault();
            pedalEl.classList.add('active');
            invoke("send_cc", { ctrl: 64, value: 127 });
        }, {passive: false});
        pedalEl.addEventListener("touchend", (e) => {
            e.preventDefault();
            pedalEl.classList.remove('active');
            invoke("send_cc", { ctrl: 64, value: 0 });
        }, {passive: false});
    }

    const instrumentSelect = document.getElementById('instrument-select');
    if (instrumentSelect) {
        instrumentSelect.addEventListener('change', (e) => {
            const program = parseInt(e.target.value, 10);
            invoke("change_instrument", { program });
        });
    }

    const midiSelect = document.getElementById('midi-select');
    if (midiSelect) {
        invoke("list_midi_ports").then(ports => {
            midiSelect.innerHTML = '';
            if (ports.length === 0) {
                const opt = document.createElement('option');
                opt.value = "";
                opt.textContent = "No MIDI inputs found";
                midiSelect.appendChild(opt);
            } else {
                ports.forEach(port => {
                    const opt = document.createElement('option');
                    opt.value = port;
                    opt.textContent = port;
                    midiSelect.appendChild(opt);
                });
            }
        });

        midiSelect.addEventListener('change', (e) => {
            const portName = e.target.value;
            if (portName) {
                invoke("select_midi_port", { portName }).catch(err => {
                    console.error("Failed to select MIDI port:", err);
                    alert("Failed to connect to MIDI port: " + err);
                });
            }
        });
    }

    const toggleVisualsEl = document.getElementById('toggle-visuals');
    if (toggleVisualsEl) {
        toggleVisualsEl.addEventListener('click', () => {
            visualMode = (visualMode + 1) % 3; // Cycle: 0, 1, 2 = OFF, 2D, 3D
            
            toggleVisualsEl.classList.remove('active', 'intermediate');
            
            if (visualMode === 2) {
                toggleVisualsEl.classList.add('active');
                toggleVisualsEl.textContent = "Visuals: 3D FX";
                if (renderer) renderer.domElement.style.opacity = "1";
            } else if (visualMode === 1) {
                toggleVisualsEl.classList.add('intermediate');
                toggleVisualsEl.textContent = "Visuals: 2D FX";
                if (renderer) renderer.domElement.style.opacity = "1";
            } else {
                toggleVisualsEl.textContent = "Visuals: OFF";
                if (renderer) {
                    renderer.clear();
                    renderer.domElement.style.opacity = "0";
                }
                
                trackNotes.length = 0;
                activeTrackNotes.clear();
            }
        });
    }

    const volumeSlider = document.getElementById('volume-slider');
    if (volumeSlider) {
        // Set the initial volume from the slider on load
        setTimeout(() => invoke("set_volume", { volume: parseFloat(volumeSlider.value) }), 500);

        volumeSlider.addEventListener('input', (e) => {
            const volume = parseFloat(e.target.value);
            invoke("set_volume", { volume });
        });
    }
});
