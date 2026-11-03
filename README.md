# Velody 🎧

App de escritorio para separar canciones en pistas (voz, batería, bajo, guitarra, piano, otros) y practicar sobre ellas — 100% local, sin nube.

<table align="center">
  <tr>
    <td align="center">
      <img src=".github/screenshots/reproductor.png" width="220" alt="Reproductor con stems separados, BPM detectado y controles de mezcla" /><br/>
      <sub><b>Reproductor</b></sub>
    </td>
  </tr>
</table>

## Por qué existe

Las herramientas de separación de stems suelen ser un servicio online: subes tu canción, esperas en una cola, y confías en que alguien más no se quede con tu archivo. Velody hace lo mismo pero corriendo enteramente en tu máquina — nada se sube a ningún lado, no hay cuentas, no hay telemetría.

## Features

- 🎚️ Separación en hasta 6 stems (voz, batería, bajo, guitarra, piano, otros) con Demucs, sin guardar stems vacíos
- 💾 Calidad elegible por canción (128 / 192 / 320 kbps)
- 🎧 Reproductor con volumen, pan, mute y solo por stem, sincronizado sample a sample; arranca donde empieza la música
- 🐢 Velocidad 50–150 % sin cambiar el tono y transposición ±12 semitonos, en tiempo real
- 📊 Detección automática de BPM, rejilla de beats y del "1" del compás (analizada en segundo plano)
- 🥁 Metrónomo y count-in amarrados a la rejilla de la canción
- 🎙️ Grabar sobre un stem (por ejemplo, reemplazar la voz con la tuya)
- 📥 Importar desde YouTube, uno o en lote
- 💾 Exportar stems o la mezcla final
- 🔄 Se actualiza sola desde GitHub Releases (AppImage / .deb)

## Cómo está resuelto

- **Todo corre local** — Python (Demucs, FFmpeg) se invoca como subproceso desde Electron, comunicándose por líneas JSON en stdout. No hay backend ni nube involucrados.
- **Mutear un stem baja su ganancia a 0** en vez de detener la fuente de audio — así los stems nunca pierden sincronía entre sí.
- La **detección de BPM combina un modelo de deep learning** (TempoCNN) **con refinamiento por beat-tracking clásico** (librosa) para mayor precisión.

## Stack

Electron · React · TypeScript · Python (Demucs, FFmpeg, librosa, TensorFlow)

## Licencia

MIT — ver [LICENSE](LICENSE)
