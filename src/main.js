const { invoke } = window.__TAURI__.core;
const { listen } = window.__TAURI__.event;

let keyboardDiv;

const START_NOTE = 21; // A0
const TOTAL_KEYS = 88;
const NOTES = ["C", "C#", "D", "D#", "E", "F", "F#", "G", "G#", "A", "A#", "B"];

const keyElements = new Map();
const activeNotes = new Set();
const backendNotes = new Set();

// hex = Synthesia 2D color, kHexNum = Keysight GPU neon color
const COLORS = [
    { name: 'blue',   hex: '#38bdf8', hexNum: 0x38bdf8, kHexNum: 0x00ccff },
    { name: 'purple', hex: '#a78bfa', hexNum: 0xa78bfa, kHexNum: 0x9944ff },
    { name: 'pink',   hex: '#f472b6', hexNum: 0xf472b6, kHexNum: 0xff0088 }
];

// roundRect polyfill for older WebKitGTK builds
if (!CanvasRenderingContext2D.prototype.roundRect) {
    CanvasRenderingContext2D.prototype.roundRect = function(x, y, w, h, r) {
        r = Math.min(r, w / 2, h / 2);
        this.moveTo(x + r, y);
        this.arcTo(x + w, y,     x + w, y + h, r);
        this.arcTo(x + w, y + h, x,     y + h, r);
        this.arcTo(x,     y + h, x,     y,     r);
        this.arcTo(x,     y,     x + w, y,     r);
        this.closePath();
    };
}

function getNoteColorIdx(midiNote) {
    const ratio = (midiNote - 21) / 88;
    if (ratio < 0.35) return 0;
    if (ratio < 0.70) return 1;
    return 2;
}

function getNoteColor(midiNote) {
    return COLORS[getNoteColorIdx(midiNote)];
}

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
    if (el) {
        el.classList.add("active");
        el.classList.add("active-" + getNoteColor(midiNote).name);
    }

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
    if (el && !backendNotes.has(midiNote)) {
        el.classList.remove("active", "active-blue", "active-purple", "active-pink");
    }

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
            if (el) {
                el.classList.add("active");
                el.classList.add("active-" + getNoteColor(note).name);
            }

            if (visualMode > 0 && !activeTrackNotes.has(note)) {
                const tn = new TrackNote(note, performance.now());
                trackNotes.push(tn);
                activeTrackNotes.set(note, tn);
            }
        } else if (status === 0) {
            backendNotes.delete(note);
            const el = keyElements.get(note);
            if (el && !activeNotes.has(note)) {
                el.classList.remove("active", "active-blue", "active-purple", "active-pink");
            }

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
let noteMaterial3D, noteMaterialSynth;
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
let gridOffscreen = null; // pre-rendered grid, rebuilt on resize only

// Pre-allocated rect buffers for batched 2D rendering (avoids per-frame GC pressure)
const rects2D = [
    new Float32Array(MAX_NOTES * 4), // blue
    new Float32Array(MAX_NOTES * 4), // purple
    new Float32Array(MAX_NOTES * 4)  // pink
];

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

    // [DIAG] GPU probe — forwarded to terminal via diag_log command
    let _isSoftwareGL = false;
    {
        const gl = renderer.getContext();
        const dbg = gl.getExtension('WEBGL_debug_renderer_info');
        const vendor   = dbg ? gl.getParameter(dbg.UNMASKED_VENDOR_WEBGL)   : gl.getParameter(gl.VENDOR);
        const gpuName  = dbg ? gl.getParameter(dbg.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER);
        const glVer    = gl.getParameter(gl.VERSION);
        const isWGL2   = renderer.capabilities.isWebGL2;
        _isSoftwareGL  = /llvmpipe|softpipe|swrast|software/i.test(gpuName);
        invoke('diag_log', { msg: `WebGL: ${glVer}` });
        invoke('diag_log', { msg: `Vendor: ${vendor}` });
        invoke('diag_log', { msg: `Renderer: ${gpuName}` });
        invoke('diag_log', { msg: `WebGL2: ${isWGL2}` });
        invoke('diag_log', { msg: _isSoftwareGL
            ? '⚠ SOFTWARE RENDERING — GPU shaders run on CPU, using fast fallback shader'
            : '✓ Hardware GPU detected — full Keysight shader active' });
    }

    // Full Keysight shader: SDF rounded corners + glow halo (requires hardware GPU)
    const _fragShaderHW = `
        varying vec3 vColor;
        varying vec2 vUv;
        uniform float time;
        float roundedBoxSDF(vec2 p, vec2 b, float r) {
            vec2 q = abs(p) - b + r;
            return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
        }
        void main() {
            vec2 p    = vUv - 0.5;
            float sdf = roundedBoxSDF(p, vec2(0.42, 0.47), 0.06);
            float core = smoothstep(0.015, -0.005, sdf);
            float glow = smoothstep(0.20, 0.0, max(sdf, 0.0));
            float pulse = sin(time * 10.0 + vColor.r * 6.28) * 0.15 + 0.85;
            float headH = smoothstep(0.35, 0.5, vUv.y);
            vec3 coreCol = mix(vColor * 1.8, vec3(1.0), 0.4);
            vec3 glowCol = vColor * 2.5;
            vec3 col     = glowCol * glow * (1.0 - core) + coreCol * core;
            col         += vec3(1.0) * headH * core * pulse * 0.35;
            float alpha = max(core, glow * 0.55);
            if (alpha < 0.005) discard;
            gl_FragColor = vec4(col, alpha);
        }
    `;

    // Fallback shader: simple linear glow, no sqrt — safe on software renderers
    const _fragShaderSW = `
        varying vec3 vColor;
        varying vec2 vUv;
        uniform float time;
        void main() {
            float hg = 1.0 - abs(vUv.x - 0.5) * 2.0;
            float core = step(0.55, hg);
            float pulse = sin(time * 10.0 + vColor.r * 6.28) * 0.15 + 0.85;
            float headH = step(0.85, vUv.y) * pulse;
            vec3 col = vColor * (0.7 + hg * 1.8) + vec3(1.0) * headH * 0.4;
            float alpha = clamp(hg * 1.4, 0.0, 1.0);
            if (alpha < 0.01) discard;
            gl_FragColor = vec4(col, alpha);
        }
    `;

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
        fragmentShader: _isSoftwareGL ? _fragShaderSW : _fragShaderHW,
        transparent: true,
        blending: THREE.AdditiveBlending,
        depthWrite: false
    });

    // Synthesia flat shader — opaque rects, top highlight, NormalBlending (no CPU canvas needed)
    noteMaterialSynth = new THREE.ShaderMaterial({
        uniforms: {},
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
            void main() {
                float topLight = mix(0.78, 1.18, vUv.y);
                vec3 col = clamp(vColor * topLight, 0.0, 1.0);
                float alpha = smoothstep(0.0, 0.03, vUv.y);
                gl_FragColor = vec4(col, alpha);
            }
        `,
        transparent: true,
        blending: THREE.NormalBlending,
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
                float val    = (vUv.x * 52.0 - 2.0) / 7.0;
                float lineV  = abs(fract(val) - 0.5) * 2.0;
                float edgeX  = smoothstep(0.97, 1.0, lineV);

                vec3 bg      = vec3(0.05, 0.05, 0.07);
                vec3 lineCol = vec3(0.13, 0.13, 0.17);
                vec3 col     = mix(bg, lineCol, edgeX);

                float fade = smoothstep(1.0, 0.05, vUv.y);
                gl_FragColor = vec4(col, fade * 0.93);
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
    _buildGridOffscreen();
}

function _buildGridOffscreen() {
    const W = cachedW, H = cachedH;
    if (W <= 0 || H <= 0) return;
    const dpr = window.devicePixelRatio;
    gridOffscreen = document.createElement('canvas');
    gridOffscreen.width  = Math.round(W * dpr);
    gridOffscreen.height = Math.round(H * dpr);
    const gctx = gridOffscreen.getContext('2d');
    gctx.scale(dpr, dpr);
    for (let i = 0; i < 52; i++) {
        const isC = ((i - 2) % 7 + 7) % 7 === 0;
        gctx.fillStyle = isC ? 'rgba(255,255,255,0.07)' : 'rgba(255,255,255,0.025)';
        gctx.fillRect((i / 52) * W | 0, 0, 1, H);
    }
}

// [DIAG] Frame timing — logs avg FPS every 5s to console
let _diagFrames = 0, _diagDeltaSum = 0, _diagLastLog = 0;

function animate(time) {
    if (!lastTime) lastTime = time;
    if (!renderer) {
        requestAnimationFrame(animate);
        return;
    }

    // [DIAG] accumulate frame delta, log every 5 seconds
    const _delta = time - lastTime;
    if (_delta > 0 && _delta < 500) {
        _diagDeltaSum += _delta;
        _diagFrames++;
    }
    if (time - _diagLastLog > 5000 && _diagFrames > 0) {
        const fps = (1000 / (_diagDeltaSum / _diagFrames)).toFixed(1);
        const ms  = (_diagDeltaSum / _diagFrames).toFixed(1);
        invoke('diag_log', { msg: `mode=${visualMode === 2 ? 'Keysight' : 'Synthesia'} fps=${fps} frame=${ms}ms notes=${trackNotes.length}` });
        _diagFrames = 0; _diagDeltaSum = 0; _diagLastLog = time;
    }

    if (visualMode === 0) {
        if (renderer.domElement.style.display !== 'none') renderer.domElement.style.display = 'none';
        lastTime = time;
        requestAnimationFrame(animate);
        return;
    }

    // --- Both Synthesia and Keysight use WebGL ---
    // Canvas2D was 5 FPS on macOS WKWebView (CPU path). WebGL uses Metal → 8x faster.
    if (renderer.domElement.style.display === 'none') {
        renderer.domElement.style.display = 'block';
        renderer.domElement.style.opacity = '1';
    }

    const isSynth = visualMode === 1;
    notesMesh.material = isSynth ? noteMaterialSynth : noteMaterial3D;
    particlesMesh.visible = !isSynth;

    const speed = 0.025;
    let instanceIdx = 0;
    let particlesEmitted = false;

    let writeIdx = 0;
    for (let i = 0; i < trackNotes.length; i++) {
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

        if (tailY > 300) continue; // drop — no splice = O(n)

        trackNotes[writeIdx++] = noteObj;

        const height = headY - tailY;
        if (height < 0.01) continue;

        dummy.position.set(xPos + width / 2, tailY, 0);
        dummy.scale.set(width * 0.9, height, 1.0);
        dummy.updateMatrix();

        const noteC = getNoteColor(noteObj.midiNote);
        // Synthesia: opaque flat colors; Keysight: neon additive colors
        _colorObj.setHex(isSynth ? noteC.hexNum : noteC.kHexNum);
        if (!noteObj.active) _colorObj.multiplyScalar(isSynth ? 0.65 : 0.55);

        if (instanceIdx < MAX_NOTES) {
            notesMesh.setMatrixAt(instanceIdx, dummy.matrix);
            notesMesh.setColorAt(instanceIdx, _colorObj);
            instanceIdx++;
        }

        if (!isSynth && noteObj.active && Math.random() > 0.65) {
            emitParticle(xPos + width / 2, headY, _colorObj.r, _colorObj.g, _colorObj.b, 1);
            particlesEmitted = true;
        }
    }
    trackNotes.length = writeIdx;

    notesMesh.count = Math.min(instanceIdx, MAX_NOTES);
    notesMesh.instanceMatrix.needsUpdate = true;
    if (notesMesh.instanceColor) notesMesh.instanceColor.needsUpdate = true;

    // Particle simulation — only matters in Keysight mode
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
            if (particlesEmitted) {
                particlesMesh.geometry.attributes.customColor.needsUpdate = true;
            }
        }
    }

    // Keysight shader uses time uniform; Synthesia material has no uniforms
    if (!isSynth) notesMesh.material.uniforms.time.value = time * 0.001;

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

    const visualsSelect = document.getElementById('visuals-select');
    if (visualsSelect) {
        visualsSelect.addEventListener('change', (e) => {
            visualMode = parseInt(e.target.value, 10);
            if (visualMode === 0) {
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
    const volumeBottomSlider = document.getElementById('volume-bottom-slider');
    
    function updateVolume(val) {
        if(volumeSlider) volumeSlider.value = val;
        if(volumeBottomSlider) volumeBottomSlider.value = val;
        invoke("set_volume", { volume: Number.parseFloat(val) / 100 });
    }

    if (volumeSlider) {
        setTimeout(() => invoke("set_volume", { volume: Number.parseFloat(volumeSlider.value) / 100 }), 500);
        volumeSlider.addEventListener('input', (e) => updateVolume(e.target.value));
    }
    if (volumeBottomSlider) {
        volumeBottomSlider.addEventListener('input', (e) => updateVolume(e.target.value));
    }
});
