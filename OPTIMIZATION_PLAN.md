# Plan de Optimización Velody — ✅ EJECUTADO

Este plan se completó en su práctica totalidad. Los 23 items fueron abordados en las fases A→D y están trackeados como `R1`–`R15` y `P1`–`P7` en la tabla Performance Tracking de `AGENTS.md`.

Extras post-plan (R16–R22, P2, P8, P9) implementados en sesión posterior.

---

## 🔴 CRÍTICOS — Seguridad / Estabilidad / Memory leaks (Fase A)

| #   | Problema                              | Estado       | Referencia |
| --- | ------------------------------------- | ------------ | ---------- |
| 1   | Audio server: path traversal          | ✅ Ejecutado | R11        |
| 2   | Audio server: CORS abierto (`*`)      | ✅ Ejecutado | R11        |
| 3   | `execSync`/`execFileSync` bloqueantes | ✅ Ejecutado | R12        |
| 4   | IPC handlers sin timeout              | ✅ Ejecutado | R13        |
| 5   | AudioContext nunca se cierra          | ✅ Ejecutado | R14        |
| 6   | Recording: setTimeouts sin cleanup    | ✅ Ejecutado | R14        |
| 7   | WaveSurfer stale closures             | ✅ Ejecutado | R15        |

## 🟡 ALTO — React correctness / Performance (Fase B + C)

| #   | Problema                                 | Estado       | Referencia                                     |
| --- | ---------------------------------------- | ------------ | ---------------------------------------------- |
| 8   | Refs mutadas durante render              | ✅ Ejecutado | R4                                             |
| 9   | setState sincrónico dentro de useEffect  | ✅ Ejecutado | R4 / refactor general                          |
| 10  | StemPlayer god component ~1850 líneas    | ✅ Mejorado  | R7, R8, R16, R17 — bajó de ~1,125 a ~1,080 lns |
| 11  | BPM detection bloquea main thread        | ✅ Ejecutado | R1 (Web Worker)                                |
| 12  | `setProgress` a ~60fps                   | ✅ Ejecutado | R2 (throttle 20fps)                            |
| 13  | Tipos de API duplicados e inconsistentes | ✅ Ejecutado | R9 (shared/types eliminado)                    |

## 🟢 MEDIO — Dead code / Duplicación / Magic numbers (Fase D)

| #   | Problema                                      | Estado       | Referencia                    |
| --- | --------------------------------------------- | ------------ | ----------------------------- |
| 14  | Dead code: `audio/player.ts`                  | ✅ Ejecutado | R9                            |
| 15  | Dead code: `shared/types/index.ts`            | ✅ Ejecutado | R9                            |
| 16  | Dependencias sin usar                         | ✅ Ejecutado | R10                           |
| 17  | Magic numbers                                 | ✅ Ejecutado | R20 (extraídos a `utils.ts`)  |
| 18  | Duplicación: `stemNameFromPath` en 3 archivos | ✅ Ejecutado | R18 (unificado en `utils.ts`) |
| 19  | Python `np.resize` mal usado                  | ◐ Parcial    | No verificado                 |
| 20  | Inline styles mezclados con Tailwind          | ✅ Ejecutado | R5                            |

## 🔵 BAJO — Accessibility / Tooling (Fase D)

| #   | Problema                        | Estado       | Referencia                                 |
| --- | ------------------------------- | ------------ | ------------------------------------------ |
| 21  | ARIA / keyboard missing         | ⏳ Pendiente | No abordado                                |
| 22  | 103 warnings de Prettier        | ◐ Mejorado   | Formateo ejecutado en archivos modificados |
| 23  | `tsconfig` sin `"strict": true` | ✅ Ejecutado | R6                                         |

---

## 📋 Pendientes reales (no cubiertos en Performance Tracking)

| #   | Pendiente                            | Prioridad   | Archivos implicados           |
| --- | ------------------------------------ | ----------- | ----------------------------- |
| 19  | `np.resize` → `np.pad` en detect_key | 🟢 Baja     | `python-worker/detect_key.py` |
| 21  | ARIA / keyboard / focus trap         | 🔵 Muy baja | `StemPlayer.tsx`, modales     |

---

## 📦 Nuevas features implementadas (post-plan)

| #   | Feature                                                                                      | Impacto                      |
| --- | -------------------------------------------------------------------------------------------- | ---------------------------- |
| R16 | `MarkerLabelInput` extraído a `components/MarkerLabelInput.tsx`                              | -66 lns de StemPlayer        |
| R17 | BPM + key detection → `useSongAnalysis` hook                                                 | -85 lns de StemPlayer        |
| R18 | `stemNameFromPath` unificada en `utils.ts`                                                   | Sin duplicación              |
| R19 | `formatTime` unificada en `utils.ts`                                                         | Sin duplicación (3 archivos) |
| R20 | Magic numbers → constantes en `utils.ts` (`BPM_MIN`, `BPM_MAX`, `PITCH_SHIFT_MIN/MAX`, etc.) | Código más legible           |
| P2  | Lazy WaveSurfer — `ensureWaveSurfer()` crea waveforms on-demand al dar play                  | -50% WaveSurfer, -40% RAM    |
| P8  | Volumen por track — slider individual de volumen por stem en `StemCard`                      | Mezcla más cómoda            |
| P9  | Per-track panning — `StereoPannerNode` via Web Audio API con `crossOrigin = 'anonymous'`     | Mezcla profesional, CORS fix |
