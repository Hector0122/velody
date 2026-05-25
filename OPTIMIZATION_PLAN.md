# Plan de Optimización Velody

## 🔴 CRÍTICOS — Seguridad / Estabilidad / Memory leaks

| #   | Problema                                                                                                        | Archivo                                      | Líneas                    | Fix estimado                                                  |
| --- | --------------------------------------------------------------------------------------------------------------- | -------------------------------------------- | ------------------------- | ------------------------------------------------------------- |
| 1   | **Audio server: path traversal** — `../../` permite leer cualquier archivo del disco                            | `src/main/audio-server.ts`                   | 18–56                     | Sanitizar con `path.resolve` + whitelist de `output/stems/`   |
| 2   | **Audio server: CORS abierto (`*`)**                                                                            | `src/main/audio-server.ts`                   | 54                        | `Access-Control-Allow-Origin: 'http://localhost:<vite-port>'` |
| 3   | **`execSync`/`execFileSync` bloqueantes** — key detection y ffprobe congelan Electron main thread               | `src/main/ipc/handlers.ts`                   | 187, 317                  | Convertir a `execFile`/`spawn` async                          |
| 4   | **IPC handlers sin timeout** — si Demucs/FFmpeg se cuelgan, el proceso queda zombie y la promesa nunca resuelve | `src/main/ipc/handlers.ts`                   | 208–241, 329–383, 433–468 | Agregar `timeout` a `spawn` + `proc.kill()`                   |
| 5   | **AudioContext nunca se cierra** — límite de ~6 por pestaña en Chrome                                           | `src/renderer/src/components/StemPlayer.tsx` | 147, 593–602              | `useEffect(() => () => audioCtxRef.current?.close(), [])`     |
| 6   | **Recording: setTimeouts sin cleanup** — si el usuario cierra mid-countdown, los timers quedan vivos            | `src/renderer/src/components/StemPlayer.tsx` | 918–939                   | Almacenar IDs en refs, limpiar en effect cleanup              |
| 7   | **WaveSurfer stale closures** — click handler captura `duration` viejo                                          | `src/renderer/src/components/StemPlayer.tsx` | 437–495                   | Usar `durationRef` o re-register listeners                    |

## 🟡 ALTO — React correctness / Performance

| #   | Problema                                                                                                                                                | Archivo                                                                  | Líneas       | Fix estimado                                                                                               |
| --- | ------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------ | ------------ | ---------------------------------------------------------------------------------------------------------- |
| 8   | **Refs mutadas durante render** — `stemsRef.current = allStems`, `activeRef.current = active`, etc. (8 errores ESLint `react-hooks/refs`)               | `src/renderer/src/components/StemPlayer.tsx`                             | 141, 156–161 | Mover a un solo `useEffect`                                                                                |
| 9   | **setState sincrónico dentro de `useEffect`** — `MarkerLabelInput` y `App.tsx`                                                                          | `src/renderer/src/components/StemPlayer.tsx`, `src/renderer/src/App.tsx` | 1814, 10     | Inicializar en `useState(() => ...)`                                                                       |
| 10  | **StemPlayer.tsx es un god component de ~1850 líneas** — hace TODO: audio, waveforms, metrónomo, grabación, loop, export, Jam Zone                      | `src/renderer/src/components/StemPlayer.tsx`                             | 1–1850       | Extraer a: `useAudioEngine`, `useMetronome`, `useRecording`, `<Timeline />`, `<JamZone />`, `<StemGrid />` |
| 11  | **BPM detection bloquea el main thread** — FFT + autocorrelation en UI thread                                                                           | `src/renderer/src/components/StemPlayer.tsx`                             | 234–370      | Mover a Web Worker                                                                                         |
| 12  | **`setProgress` a ~60fps** — `onAudioTime` re-renderiza todo StemPlayer constantemente                                                                  | `src/renderer/src/components/StemPlayer.tsx`                             | 656–684      | Usar `requestAnimationFrame` + ref ligero, no React state                                                  |
| 13  | **Tipos de API duplicados e inconsistentes** — `preload/index.d.ts` vs `env.d.ts`: `openInBrowser` vs `openExternal`, `deleteSong` return type diffiere | `src/preload/index.d.ts`, `src/renderer/src/env.d.ts`                    | —            | Consolidar en `shared/preload-api.ts`                                                                      |

## 🟢 MEDIO — Dead code / Duplicación / Magic numbers

| #   | Problema                                                                      | Archivo                                      | Líneas                       | Fix estimado                                    |
| --- | ----------------------------------------------------------------------------- | -------------------------------------------- | ---------------------------- | ----------------------------------------------- |
| 14  | **Dead code**: `audio/player.ts` clase sin usar                               | `src/renderer/src/audio/player.ts`           | 1–52                         | Borrar archivo                                  |
| 15  | **Dead code**: `shared/types/index.ts` interfaces sin usar                    | `shared/types/index.ts`                      | 1–21                         | Borrar o adoptar en todo el codebase            |
| 16  | **Dependencias sin usar**: `electron-updater`, `@electron-toolkit/preload`    | `package.json`                               | —                            | Limpiar dependencias                            |
| 17  | **Magic numbers**: `CACHE_VERSION = 9`, `44100`, `0.008`, `0.02`, etc.        | `src/renderer/src/components/StemPlayer.tsx` | 5, 275, 299, 313, 566        | Extraer a `src/renderer/src/constants.ts`       |
| 18  | **Duplicación**: `stemNameFromPath` copiada en 3 archivos                     | `StemPlayer.tsx`, `Home.tsx`, `handlers.ts`  | 25, 118–122, 30–34           | Extraer a `shared/utils.ts`                     |
| 19  | **Python `np.resize` mal usado** — corrupte datos de audio en vez de zero-pad | `python-worker/detect_key.py`                | 87                           | Usar `np.pad(..., mode='constant')`             |
| 20  | **Inline styles mezclados con Tailwind**                                      | `src/renderer/src/components/StemPlayer.tsx` | 1127, 1139, 1169, 1206, etc. | Mover a clases Tailwind con valores arbitrarios |

## 🔵 BAJO — Accessibility / Tooling

| #   | Problema                                                                                                                          | Archivo                                   | Fix estimado                                                                |
| --- | --------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------- |
| 21  | **ARIA / keyboard missing** — sliders sin `aria-label`, divs clickeables sin `role="button"` o `tabIndex`, modales sin focus trap | `StemPlayer.tsx`                          | Agregar ARIA attrs, convertir divs a buttons, implementar focus trap básico |
| 22  | **103 warnings de Prettier**                                                                                                      | `StemPlayer.tsx`, `Fretboard.tsx`         | `npm run format`                                                            |
| 23  | **`tsconfig` sin `"strict": true`**                                                                                               | `tsconfig.web.json`, `tsconfig.node.json` | Agregar `"strict": true`                                                    |

---

## 📋 Orden de ejecución recomendado

### Fase A — Seguridad + Estabilidad (bloqueante)

1. Arreglar audio-server (path traversal + CORS)
2. Convertir `execSync` a async en main process
3. Agregar timeouts a IPC handlers + cleanup de procesos
4. Cerrar AudioContext / limpiar recording timers

### Fase B — React correctness

5. Eliminar ref mutations during render
6. Eliminar setState sincrónico en effects
7. Fix WaveSurfer lifecycle (stale closures, cleanup)

### Fase C — Performance + Arquitectura

8. Extraer progress tracking a ref ligero (dejar de re-renderizar a 60fps)
9. Mover BPM detection a Web Worker
10. Descomponer StemPlayer en sub-components/hooks

### Fase D — Polish

11. Limpiar dead code y dependencias
12. Consolidar tipos de API
13. `npm run format` + activar strict TypeScript
14. ARIA / keyboard basics

---

## Notas

- **Impacto estimado por fase**:
  - Fase A: elimina crashes, freezes y vulnerabilidades
  - Fase B: elimina bugs sutiles de sincronización
  - Fase C: reduce re-renders de ~60fps a ~1fps, hace el codebase mantenible
  - Fase D: reduce deuda técnica y mejora accesibilidad

- **No tocar durante optimización**:
  - Funcionalidad de usuario (features existentes)
  - Flujo de grabación / playback / export
  - Lógica de Demucs / Python worker (salvo `np.resize`)

- **Tests antes de empezar**:
  - Verificar que `npm run typecheck` pasa
  - Verificar que `npm run dev` levanta sin errores
  - Hacer una grabación de prueba completa (REC → Save → Playback)
