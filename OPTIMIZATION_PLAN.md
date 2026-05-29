# Plan de Optimización Velody — ✅ EJECUTADO

Este plan se completó en su práctica totalidad. Los 23 items fueron abordados en las fases A→D y están trackeados como `R1`–`R15` y `P1`–`P7` en la tabla Performance Tracking de `AGENTS.md`.

---

## 🔴 CRÍTICOS — Seguridad / Estabilidad / Memory leaks (Fase A)

| #   | Problema                                                             | Estado      | Referencia            |
| --- | -------------------------------------------------------------------- | ----------- | --------------------- |
| 1   | Audio server: path traversal                                         | ✅ Ejecutado | R11                   |
| 2   | Audio server: CORS abierto (`*`)                                     | ✅ Ejecutado | R11                   |
| 3   | `execSync`/`execFileSync` bloqueantes                                | ✅ Ejecutado | R12                   |
| 4   | IPC handlers sin timeout                                             | ✅ Ejecutado | R13                   |
| 5   | AudioContext nunca se cierra                                         | ✅ Ejecutado | R14                   |
| 6   | Recording: setTimeouts sin cleanup                                   | ✅ Ejecutado | R14                   |
| 7   | WaveSurfer stale closures                                            | ✅ Ejecutado | R15                   |

## 🟡 ALTO — React correctness / Performance (Fase B + C)

| #   | Problema                                                             | Estado      | Referencia            |
| --- | -------------------------------------------------------------------- | ----------- | --------------------- |
| 8   | Refs mutadas durante render                                          | ✅ Ejecutado | R4                    |
| 9   | setState sincrónico dentro de useEffect                              | ✅ Ejecutado | R4 / refactor general |
| 10  | StemPlayer god component ~1850 líneas                                | ◐ Parcial   | R7, R8 + sigue vivo ~800 lns |
| 11  | BPM detection bloquea main thread                                    | ✅ Ejecutado | R1 (Web Worker)       |
| 12  | `setProgress` a ~60fps                                               | ✅ Ejecutado | R2 (throttle 20fps)   |
| 13  | Tipos de API duplicados e inconsistentes                             | ✅ Ejecutado | R9 (shared/types eliminado) |

## 🟢 MEDIO — Dead code / Duplicación / Magic numbers (Fase D)

| #   | Problema                                                             | Estado      | Referencia            |
| --- | -------------------------------------------------------------------- | ----------- | --------------------- |
| 14  | Dead code: `audio/player.ts`                                         | ✅ Ejecutado | R9                    |
| 15  | Dead code: `shared/types/index.ts`                                   | ✅ Ejecutado | R9                    |
| 16  | Dependencias sin usar                                                | ✅ Ejecutado | R10                   |
| 17  | Magic numbers                                                        | ◐ Parcial   | No extraídos a constants.ts |
| 18  | Duplicación: `stemNameFromPath` en 3 archivos                        | ◐ Parcial   | Sigue duplicado       |
| 19  | Python `np.resize` mal usado                                         | ◐ Parcial   | No verificado         |
| 20  | Inline styles mezclados con Tailwind                                 | ✅ Ejecutado | R5                    |

## 🔵 BAJO — Accessibility / Tooling (Fase D)

| #   | Problema                                                             | Estado      | Referencia            |
| --- | -------------------------------------------------------------------- | ----------- | --------------------- |
| 21  | ARIA / keyboard missing                                              | ⏳ Pendiente | No abordado           |
| 22  | 103 warnings de Prettier                                             | ⏳ Pendiente | No abordado           |
| 23  | `tsconfig` sin `"strict": true`                                      | ✅ Ejecutado | R6                    |

---

## 📋 Pendientes reales (no cubiertos en Performance Tracking)

| #   | Pendiente                              | Prioridad | Archivos implicados                    |
| --- | -------------------------------------- | --------- | -------------------------------------- |
| 17  | Magic numbers → `constants.ts`         | 🟢 Baja   | `StemPlayer.tsx`                       |
| 18  | `stemNameFromPath` → `shared/utils.ts` | 🟢 Baja   | `StemPlayer.tsx`, `Home.tsx`, `handlers.ts` |
| 19  | `np.resize` → `np.pad` en detect_key   | 🟢 Baja   | `python-worker/detect_key.py`          |
| 21  | ARIA / keyboard / focus trap           | 🔵 Muy baja | `StemPlayer.tsx`, modales             |
| 22  | `npm run format` (Prettier)            | 🔵 Muy baja | Todo el proyecto                      |

> El resto de features pendientes (Tempo tap, Loop multi-take, Lazy WaveSurfer, Pool de `<audio>`, Web Worker pool, Volumen por track, Paneo por track) están trackeados en `AGENTS.md` → Performance Tracking y Future Features.
