# Midibian 🎹✨

Midibian es un avanzado teclado MIDI interactivo construido con **Tauri, Rust y WebGL (Three.js)**. Combina un rendimiento extremo gracias a Rust y un diseño web moderno (Glassmorphism), logrando una experiencia de sonido profesional y una interfaz inmersiva y reactiva.

## 🚀 Características Principales

- **Conexión Directa MIDI**: Detecta e interactúa instantáneamente con teclados y controladores MIDI que conectes a tu equipo.
- **Rendimiento Acelerado por Hardware**: Aprovecha completamente tu GPU para mostrar visuales tridimensionales (3D FX) interactivos.
- **Modos Visuales Inteligentes**:
  - **3D FX**: Cascadas 3D hiper-reactivas completadas con partículas realistas y shaders avanzados de luces de colores estilo neón.
  - **2D FX (Modo Synthesia)**: Visualización clásica y ligera con guías de octavas. Muy bajo consumo de recursos gráficos.
  - **OFF**: Interfaz pura de piano, centrada en maximizar tu CPU/GPU solo en las muestras de audio.
- **Fluidsynth Engine integrado**: Utiliza Rust y Fluidsynth directamente en el backend para eliminar el latido (lag) entre el teclado web y la generación real del sonido. Soporta fuentes de sonido (SoundFonts `.sf2`).
- **Aspecto GTK & macOS (Auto-Detección Absoluta)**: Tema Glassmorphism ultra premium que se adapta instantáneamente entre modo claro y oscuro de acuerdo con tu sistema operativo de manera nativa.
- **Ajustes al Instante**: Soporte incorporado para el pedal de sustain y controles refinados de master-volume directos en pantalla.

## 📦 Requisitos Previos

Necesitas un sistema capaz de ejecutar Rust y Node. Las dependencias mínimas requeridas suelen ser las de desarrollo de Tauri en tu plataforma local.

*En plataformas basadas en Debian/Ubuntu (`apt`)*:
\`\`\`bash
sudo apt update
sudo apt install libwebkit2gtk-4.1-dev build-essential curl wget file libxdo-dev libssl-dev libayatana-appindicator3-dev librsvg2-dev
\`\`\`

## 🛠️ Cómo Ejecutar en Modo Desarrollo

Sitúate en la raíz del proyecto y usa Node Version Manager (u otro gestor) si lo necesitas. Ejecuta directamente el entorno Tauri para compilar al instante y abrir el Piano interactivo:

\`\`\`bash
# Ejecutar localmente con hot reload
npm run tauri dev
\`\`\`

> **Nota para usuarios de Linux (NVIDIA/KMS)**: Si la previsualización experimenta un "crash" por aceleración de hardware en tu driver de video y ves el programa en blanco o negro, ejecuta el comando deshabilitando el renderizador hardware: `PIANO_NO_HW_ACCEL=1 npm run tauri dev`

## 🏗️ Cómo Generar el Instalable Final

Midibian utiliza Tauri v2 para compilar rápidamente tu código web y tu backend de rust en instalables nativos `.deb`, `.rpm` y `.AppImage` (Linux) o instaladores para Windows/Mac.

\`\`\`bash
npm run tauri build
\`\`\`

El binario y los archivos de tu instalador estarán en \`src-tauri/target/release/bundle/\`. ¡Busca el .deb para tu Debian e instálalo!

## 🔧 Archivos de Fuente de Sonido / SoundFont (.sf2)

Si usas Linux, la app buscará un archivo SoundFont en directorios típicos como `/usr/share/sounds/sf2/FluidR3_GM.sf2`. ¡Para mayor fiabilidad o distribuciones portables, deja un archivo de sonido general renombrado como \`default.sf2\` directamente en la misma carpeta raíz/ejecutable del proyecto!

---

*Desarrollado con ❤️ combinando el poder del backend nativo (Rust) con la belleza UI infinita de la web.*
