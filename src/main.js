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
        const prevWhite = noteDimensions[midiNote - 1];
        noteDimensions[midiNote] = { isBlack: true, whiteIndex: prevWhite.whiteIndex };
    }
}

function _getNotePositionRaw(midiNote, totalWidth) {
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

const cachedNoteLayout = new Map();
for (let i = 0; i < TOTAL_KEYS; i++) {
    const n = START_NOTE + i;
    cachedNoteLayout.set(n, _getNotePositionRaw(n, 100));
}

function getNotePosition(midiNote) {
    return cachedNoteLayout.get(midiNote);
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

function triggerNoteOn(midiNote, velocity) {
    if (activeNotes.has(midiNote)) return;
    activeNotes.add(midiNote);

    const el = keyElements.get(midiNote);
    if (el) el.classList.add("active");

    if (visualMode > 0) {
        const tn = new TrackNote(midiNote, performance.now());
        trackNotes.push(tn);
        activeTrackNotes.set(midiNote, tn);
    }

    // Fire-and-forget: audio runs on Rust thread, no need to await the IPC roundtrip.
    // Awaiting here created a microtask per keypress that could delay the next rAF frame.
    invoke("play_note", { note: midiNote, velocity });
}

function triggerNoteOff(midiNote) {
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

    invoke("stop_note", { note: midiNote });
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

// --- Visualizer state ---
let visualMode = 2; // 2 = 3D FX, 1 = 2D FX, 0 = OFF
let scene, camera, renderer, notesMesh, gridMesh;
let noteMaterial3D;
const MAX_NOTES = 1000;
const dummy = new THREE.Object3D();
// Pre-allocated color object — never re-created inside the animation loop
const _colorObj = new THREE.Color();

let particlesMesh;
const MAX_PARTICLES = 500;
const particlePos = new Float32Array(MAX_PARTICLES * 3);
const particleVel = new Float32Array(MAX_PARTICLES * 3);
const particleLife = new Float32Array(MAX_PARTICLES);
const particleColor = new Float32Array(MAX_PARTICLES * 3);
let particleIndex = 0;

// Native 2D Canvas variables
let canvas2D, ctx2D;
let cachedW = 0, cachedH = 0;

// Pre-allocated rect buffers for batched 2D rendering (avoids per-frame GC pressure)
const whiteRects2D = new Float32Array(MAX_NOTES * 4);
const blackRects2D = new Float32Array(MAX_NOTES * 4);

function emitParticle(x, y, r, g, b, count) {
    for (let i = 0; i < count; i++) {
        particlePos[particleIndex * 3]     = x + (Math.random() - 0.5) * 1.5;
        particlePos[particleIndex * 3 + 1] = y + (Math.random() - 0.5) * 1.5;
        particlePos[particleIndex * 3 + 2] = 2;

        particleVel[particleIndex * 3]     = (Math.random() - 0.5) * 0.5;
        particleVel[particleIndex * 3 + 1] = (Math.random() - 0.5) * 0.5 - 0.1;
        particleVel[particleIndex * 3 + 2] = 0;

        particleLife[particleIndex] = 1.0 + Math.random() * 0.4;

        particleColor[particleIndex * 3]     = r * 1.2;
        particleColor[particleIndex * 3 + 1] = g * 1.2;
        particleColor[particleIndex * 3 + 2] = b * 1.2;

        particleIndex = (particleIndex + 1) % MAX_PARTICLES;
    }
}

function initThreeJS() {
    const container = document.querySelector('.track-container');
    if (!container) return;

    canvas2D = document.getElementById('track-canvas-2d');
    if (!canvas2D) {
        canvas2D = document.createElement('canvas');
        canvas2D.id = 'track-canvas-2d';
        canvas2D.style.position = 'absolute';
        canvas2D.style.top = '0';
        canvas2D.style.left = '0';
        canvas2D.style.width = '100%';
        canvas2D.style.height = '100%';
        canvas2D.style.display = 'none';
        canvas2D.style.pointerEvents = 'none';
        canvas2D.style.zIndex = '10';
        container.appendChild(canvas2D);
    }
    ctx2D = canvas2D.getContext('2d');
    window.addEventListener('resize', resize2DCanvas);
    resize2DCanvas();

    scene = new THREE.Scene();

    const aspect = container.clientWidth / container.clientHeight;
    const width3D = 100;

    camera = new THREE.OrthographicCamera(
        -width3D / 2, width3D / 2,
        width3D / aspect, 0,
        0.1, 1000
    );
    camera.position.set(0, 0, 100);
    camera.lookAt(0, 0, 0);

    renderer = new THREE.WebGLRenderer({ antialias: false, alpha: true, powerPreference: "high-performance" });
    renderer.setSize(container.clientWidth, container.clientHeight);
    // Cap pixel ratio to 1.5 — above that the GPU cost outweighs visual gain on Linux
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
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

    const geometry = new THREE.PlaneGeometry(1, 1);
    geometry.translate(0, 0.5, 0);

    notesMesh = new THREE.InstancedMesh(geometry, noteMaterial3D, MAX_NOTES);
    notesMesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);

    const colorArray = new Float32Array(MAX_NOTES * 3);
    const colorAttr = new THREE.InstancedBufferAttribute(colorArray, 3);
    notesMesh.instanceColor = colorAttr;
    notesMesh.geometry.setAttribute('instanceColor', colorAttr);

    scene.add(notesMesh);

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
                float val = (vUv.x * 52.0 - 2.0) / 7.0;
                float lineVal = abs(fract(val) - 0.5) * 2.0;
                float edgeX = smoothstep(0.97, 1.0, lineVal);

                vec3 bg = vec3(0.11, 0.11, 0.12);
                vec3 lineCol = vec3(0.22, 0.22, 0.23);
                vec3 col = mix(bg, lineCol, edgeX);

                float fade = smoothstep(1.0, 0.1, vUv.y);

                gl_FragColor = vec4(col, fade);
            }
        `,
        transparent: true,
        blending: THREE.NormalBlending,
        depthWrite: false
    });

    const gridGeometry = new THREE.PlaneGeometry(100, 300);
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

function resize2DCanvas() {
    if (!canvas2D) return;
    const rect = canvas2D.parentElement.getBoundingClientRect();
    cachedW = rect.width;
    cachedH = rect.height;
    // Assigning canvas.width resets the context state — re-apply scale after.
    canvas2D.width  = Math.round(cachedW * window.devicePixelRatio);
    canvas2D.height = Math.round(cachedH * window.devicePixelRatio);
    ctx2D.scale(window.devicePixelRatio, window.devicePixelRatio);
}

function animate(time) {
    if (!lastTime) lastTime = time;
    if (!renderer) {
        requestAnimationFrame(animate);
        return;
    }

    if (visualMode === 0) {
        if (canvas2D && canvas2D.style.display !== 'none') canvas2D.style.display = 'none';
        lastTime = time;
        requestAnimationFrame(animate);
        return;
    }

    const is3D = visualMode === 2;

    // --- Toggle canvas visibility ---
    if (is3D) {
        if (canvas2D && canvas2D.style.display !== 'none') canvas2D.style.display = 'none';
        if (renderer.domElement.style.opacity !== '1') {
            renderer.domElement.style.opacity = '1';
            renderer.domElement.style.display = 'block';
        }
    } else {
        if (canvas2D && canvas2D.style.display === 'none') canvas2D.style.display = 'block';
        if (renderer.domElement.style.display !== 'none') {
            renderer.domElement.style.display = 'none';
            renderer.domElement.style.opacity = '0';
        }

        // --- 2D Canvas Mode ---
        // Optimized: batch notes by color to minimize GPU state changes.
        // All white-note rects are drawn with one fillStyle; all black-note rects
        // with one fillStyle — O(2) state changes per frame instead of O(N).
        const speed2D = 0.4;
        const W = cachedW;
        const H = cachedH;

        ctx2D.clearRect(0, 0, W, H);

        // Octave guide lines — 7 lines, single fillStyle
        ctx2D.fillStyle = 'rgba(255,255,255,0.05)';
        for (let i = 0; i < 52; i++) {
            if ((i - 2) % 7 === 0) {
                ctx2D.fillRect((i / 52) * W | 0, 0, 1, H);
            }
        }

        // Collect note rects into pre-allocated typed arrays (no GC)
        let wCount = 0, bCount = 0;
        for (let i = trackNotes.length - 1; i >= 0; i--) {
            const noteObj = trackNotes[i];
            const timeActive = time - noteObj.timeCreated;
            const headY = timeActive * speed2D;
            let tailY = 0;

            if (!noteObj.active) {
                tailY = (time - noteObj.timeReleased) * speed2D;
                if (tailY > H + 50) {
                    trackNotes.splice(i, 1);
                    continue;
                }
            }

            const height = headY - tailY;
            if (height < 1) continue;

            const posPercent = cachedNoteLayout.get(noteObj.midiNote);
            if (!posPercent) continue;

            // Integer pixel coordinates — sharper rendering, better GPU alignment
            const rx = ((posPercent.x / 100) * W + 1) | 0;
            const ry = (H - headY) | 0;
            const rw = Math.max(((posPercent.w / 100) * W - 2) | 0, 1);
            const rh = Math.max(height | 0, 1);

            if (posPercent.isBlack) {
                blackRects2D[bCount++] = rx;
                blackRects2D[bCount++] = ry;
                blackRects2D[bCount++] = rw;
                blackRects2D[bCount++] = rh;
            } else {
                whiteRects2D[wCount++] = rx;
                whiteRects2D[wCount++] = ry;
                whiteRects2D[wCount++] = rw;
                whiteRects2D[wCount++] = rh;
            }
        }

        // Single fillStyle per color group — browser batches these as one GPU draw call
        if (wCount > 0) {
            ctx2D.fillStyle = '#60a5fa';
            for (let i = 0; i < wCount; i += 4) {
                ctx2D.fillRect(whiteRects2D[i], whiteRects2D[i + 1], whiteRects2D[i + 2], whiteRects2D[i + 3]);
            }
        }
        if (bCount > 0) {
            ctx2D.fillStyle = '#f472b6';
            for (let i = 0; i < bCount; i += 4) {
                ctx2D.fillRect(blackRects2D[i], blackRects2D[i + 1], blackRects2D[i + 2], blackRects2D[i + 3]);
            }
        }

        lastTime = time;
        requestAnimationFrame(animate);
        return;
    }

    // --- 3D WebGL Mode ---
    particlesMesh.visible = true;

    const speed = 0.025;
    let instanceIdx = 0;
    let particlesEmitted = false;

    for (let i = trackNotes.length - 1; i >= 0; i--) {
        const noteObj = trackNotes[i];
        const posPercent = getNotePosition(noteObj.midiNote);
        const xPos = -50 + posPercent.x;
        const width = posPercent.w;

        const timeActive = time - noteObj.timeCreated;
        const headY = timeActive * speed;
        let tailY = 0;

        if (!noteObj.active) {
            tailY = (time - noteObj.timeReleased) * speed;
        }

        if (tailY > 300) {
            trackNotes.splice(i, 1);
            continue;
        }

        const height = headY - tailY;
        if (height < 0.01) continue;

        dummy.position.set(xPos + width / 2, tailY, 0);
        dummy.scale.set(width * 0.85, height, 1.0);
        dummy.updateMatrix();

        // Reuse pre-allocated color object — no allocation per frame
        _colorObj.setHex(noteObj.active
            ? (posPercent.isBlack ? 0xf472b6 : 0x60a5fa)
            : (posPercent.isBlack ? 0xd946ef : 0x3b82f6));

        if (instanceIdx < MAX_NOTES) {
            notesMesh.setMatrixAt(instanceIdx, dummy.matrix);
            notesMesh.setColorAt(instanceIdx, _colorObj);
            instanceIdx++;
        }

        if (noteObj.active && Math.random() > 0.4) {
            emitParticle(xPos + width / 2, headY, _colorObj.r, _colorObj.g, _colorObj.b, 1);
            if (Math.random() > 0.7) emitParticle(xPos + width / 2, 0, _colorObj.r, _colorObj.g, _colorObj.b, 1);
            particlesEmitted = true;
        }
    }

    notesMesh.count = Math.min(instanceIdx, MAX_NOTES);
    notesMesh.instanceMatrix.needsUpdate = true;
    if (notesMesh.instanceColor) notesMesh.instanceColor.needsUpdate = true;

    // Particle simulation
    {
        const positions = particlesMesh.geometry.attributes.position.array;
        const lifes = particlesMesh.geometry.attributes.life.array;
        let activeParticles = false;
        for (let i = 0; i < MAX_PARTICLES; i++) {
            if (lifes[i] > 0) {
                lifes[i] -= 0.02;
                positions[i * 3]     += particleVel[i * 3];
                positions[i * 3 + 1] += particleVel[i * 3 + 1];
                particleVel[i * 3 + 1] -= 0.008;
                activeParticles = true;
            } else if (lifes[i] > -1) {
                positions[i * 3] = -999;
                lifes[i] = -2;
                activeParticles = true;
            }
        }
        if (activeParticles) {
            particlesMesh.geometry.attributes.position.needsUpdate = true;
            particlesMesh.geometry.attributes.life.needsUpdate = true;
            // customColor only changes when new particles are emitted
            if (particlesEmitted) {
                particlesMesh.geometry.attributes.customColor.needsUpdate = true;
            }
        }
    }

    notesMesh.material.uniforms.time.value = time * 0.001;
    // Grid shader doesn't use time in its fragment shader — skip update

    renderer.render(scene, camera);
    lastTime = time;
    requestAnimationFrame(animate);
}

window.addEventListener("DOMContentLoaded", () => {
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
            visualMode = (visualMode + 1) % 3;

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
        setTimeout(() => invoke("set_volume", { volume: Number.parseFloat(volumeSlider.value) / 100 }), 500);

        volumeSlider.addEventListener('input', (e) => {
            invoke("set_volume", { volume: Number.parseFloat(e.target.value) / 100 });
        });
    }
});
