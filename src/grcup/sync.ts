// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: keeps the GR Cup platform in step with this OpenLifter desk.
//
// A Redux middleware notices which entries changed (OpenLifter's reducers replace the object of an entry that
// changes) and whether the lifting group changed. A single sender posts those entries — the whole entry, so a
// repeat is harmless — to /api/admin/competiciones/{cid}/openlifter/sync, one request at a time, with a growing
// revision. Pending changes survive a reload (localStorage) and are retried with backoff while there is no network.
// OpenLifter's own state and screens are untouched.

import { Middleware } from "redux";

import { api, ApiError, Usuario, Competicion } from "./api";
import { Entry } from "../types/dataTypes";
import { GlobalState } from "../types/stateTypes";

export type Candidato = {
  atletaId: string;
  nombre: string;
  categoria: string;
  club?: string;
  puntuacion: number;
  motivos: Array<string>;
};

export type Vinculo = {
  entryId: number;
  nombreOL: string;
  atletaId?: string;
  nombre?: string;
  vinculo: "auto" | "confirmado" | "sugerido" | "sin_coincidencia" | "ignorado";
  puntuacion: number;
  motivo?: string;
  candidatos?: Array<Candidato>;
};

export type EstadoMesa = {
  mesa: string;
  rev: number;
  ignorada?: boolean;
  vinculos: Array<Vinculo>;
  avisos: Array<{ entryId?: number; mensaje: string }>;
  aplicado: { pesajes: number; intentos: number; veredictos: number; correcciones: number; estado: boolean };
};

export type GrcupState = {
  usuario: Usuario | null;
  competicion: Competicion | null;
  mesa: string; // pinned key of this OpenLifter meet on the platform
  activo: boolean; // synchronisation on
  estado: "desconectado" | "sincronizado" | "pendiente" | "enviando" | "error";
  error: string;
  ultimaSync: number;
  pendientes: number;
  mesaEstado: EstadoMesa | null;
};

const LS = "grcup:v1";
const LS_DIRTY = "grcup:pendientes:v1";

type Persistido = { competicion: Competicion | null; mesa: string; activo: boolean; rev: number; dispositivo: string };

function leer(): Persistido {
  try {
    const p = JSON.parse(localStorage.getItem(LS) || "{}");
    return {
      competicion: p.competicion || null,
      mesa: p.mesa || "",
      activo: !!p.activo,
      rev: Number(p.rev) || 0,
      dispositivo: p.dispositivo || Math.random().toString(36).slice(2) + Date.now().toString(36),
    };
  } catch (e) {
    return { competicion: null, mesa: "", activo: false, rev: 0, dispositivo: Math.random().toString(36).slice(2) };
  }
}

const persistido = leer();

let state: GrcupState = {
  usuario: null,
  competicion: persistido.competicion,
  mesa: persistido.mesa,
  activo: persistido.activo,
  estado: "desconectado",
  error: "",
  ultimaSync: 0,
  pendientes: 0,
  mesaEstado: null,
};

const listeners = new Set<() => void>();

export function getGrcup(): GrcupState {
  return state;
}

export function subscribeGrcup(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

function set(p: Partial<GrcupState>) {
  state = { ...state, ...p };
  persistido.competicion = state.competicion;
  persistido.mesa = state.mesa;
  persistido.activo = state.activo;
  localStorage.setItem(LS, JSON.stringify(persistido));
  listeners.forEach((fn) => fn());
}

// ---- pending changes ----

type Dirty = { todo: boolean; ids: Array<number>; borradas: Array<number>; grupo: boolean };
const dirty: { todo: boolean; ids: Set<number>; borradas: Set<number>; grupo: boolean } = (() => {
  try {
    const d: Dirty = JSON.parse(localStorage.getItem(LS_DIRTY) || "null");
    if (d) return { todo: d.todo, ids: new Set(d.ids), borradas: new Set(d.borradas), grupo: d.grupo };
  } catch (e) {
    // ignore
  }
  return { todo: false, ids: new Set<number>(), borradas: new Set<number>(), grupo: false };
})();

function guardarDirty() {
  const d: Dirty = {
    todo: dirty.todo,
    ids: Array.from(dirty.ids),
    borradas: Array.from(dirty.borradas),
    grupo: dirty.grupo,
  };
  localStorage.setItem(LS_DIRTY, JSON.stringify(d));
}

function contarPendientes(): number {
  if (dirty.todo) return getStore() ? getStore()!.getState().registration.entries.length : 1;
  return dirty.ids.size + dirty.borradas.size + (dirty.grupo ? 1 : 0);
}

// ---- the Redux store ----

type Store = { getState: () => GlobalState; dispatch: (a: any) => any };
let store: Store | null = null;
const getStore = () => store;

export function mesaPorDefecto(s: GlobalState): string {
  const nombre = (s.meet.name || "").trim() || "OpenLifter";
  return `${nombre} · ${s.meet.date || "sin fecha"}`.slice(0, 120);
}

export const grcupMiddleware: Middleware = (api0) => {
  store = api0 as unknown as Store;
  return (next) => (action: any) => {
    const prev = api0.getState() as GlobalState;
    const result = next(action);
    const cur = api0.getState() as GlobalState;
    if (action && (action.type === "OVERWRITE_STORE" || action.type === "persist/REHYDRATE")) {
      dirty.todo = true; // a loaded file or a reload: send everything once
      dirty.grupo = true;
    } else if (prev.registration !== cur.registration) {
      const antes = new Map<number, Entry>();
      prev.registration.entries.forEach((e) => antes.set(e.id, e));
      cur.registration.entries.forEach((e) => {
        if (antes.get(e.id) !== e) dirty.ids.add(e.id);
        antes.delete(e.id);
      });
      antes.forEach((_e, id) => {
        dirty.borradas.add(id);
        dirty.ids.delete(id);
      });
    }
    if (prev.lifting !== cur.lifting) dirty.grupo = true;
    if (prev !== cur) {
      guardarDirty();
      programar(300);
    }
    return result;
  };
};

// ---- the sender ----

function aEntrada(e: Entry) {
  const nums = (a: Array<number>) => (a || []).slice(0, 5).map((x) => Number(x) || 0);
  const txt = (s: string | undefined, n: number) => String(s || "").slice(0, n);
  return {
    id: e.id,
    day: e.day,
    platform: e.platform,
    flight: txt(e.flight, 2),
    name: txt(e.name, 200),
    sex: e.sex,
    birthDate: txt(e.birthDate, 10),
    intendedWeightClassKg: txt(e.intendedWeightClassKg, 10),
    divisions: (e.divisions || []).slice(0, 20).map((d) => txt(d, 100)),
    lot: Number(e.lot) || 0,
    memberId: txt(e.memberId, 64),
    team: txt(e.team, 200),
    instagram: txt(e.instagram, 100),
    notes: txt(e.notes, 2000),
    bodyweightKg: Number(e.bodyweightKg) || 0,
    squatRackInfo: txt(e.squatRackInfo, 40),
    benchRackInfo: txt(e.benchRackInfo, 40),
    squatKg: nums(e.squatKg),
    benchKg: nums(e.benchKg),
    deadliftKg: nums(e.deadliftKg),
    squatStatus: nums(e.squatStatus),
    benchStatus: nums(e.benchStatus),
    deadliftStatus: nums(e.deadliftStatus),
  };
}

let timer: ReturnType<typeof setTimeout> | null = null;
let enviando = false;
let espera = 2000;

function programar(ms: number) {
  set({
    pendientes: contarPendientes(),
    estado: !state.activo ? "desconectado" : state.estado === "error" ? "error" : enviando ? "enviando" : "pendiente",
  });
  if (!state.activo || !state.usuario || !state.competicion) return;
  if (timer) clearTimeout(timer);
  timer = setTimeout(enviar, ms);
}

function hayPendiente() {
  return dirty.todo || dirty.ids.size > 0 || dirty.borradas.size > 0 || dirty.grupo;
}

async function enviar() {
  timer = null;
  if (enviando || !store || !state.activo || !state.usuario || !state.competicion) return;
  if (!hayPendiente()) {
    set({ estado: "sincronizado", pendientes: 0 });
    return;
  }
  const s = store.getState();
  const mesa = state.mesa || mesaPorDefecto(s);
  if (!state.mesa) set({ mesa });
  // Snapshot what is sent: an entry edited while the request flies stays pending.
  const enviadas = new Map<number, Entry>();
  const todo = dirty.todo;
  s.registration.entries.forEach((e) => {
    if (todo || dirty.ids.has(e.id)) enviadas.set(e.id, e);
  });
  const borradas = Array.from(dirty.borradas);
  const grupo = dirty.grupo;
  persistido.rev += 1;
  const body = {
    mesa,
    dispositivo: persistido.dispositivo,
    rev: persistido.rev,
    grupo: { day: s.lifting.day, platform: s.lifting.platform, flight: s.lifting.flight, lift: s.lifting.lift },
    entradas: Array.from(enviadas.values()).map(aEntrada),
    borradas,
  };
  enviando = true;
  set({ estado: "enviando" });
  try {
    const r = await api<EstadoMesa>("POST", `/api/admin/competiciones/${state.competicion.id}/openlifter/sync`, body);
    const ahora = store.getState();
    const actuales = new Map<number, Entry>();
    ahora.registration.entries.forEach((e) => actuales.set(e.id, e));
    if (todo) dirty.todo = false;
    enviadas.forEach((e, id) => {
      if (actuales.get(id) === e) dirty.ids.delete(id);
      else dirty.ids.add(id); // changed meanwhile
    });
    borradas.forEach((id) => dirty.borradas.delete(id));
    if (grupo && ahora.lifting === s.lifting) dirty.grupo = false;
    guardarDirty();
    espera = 2000;
    set({
      mesaEstado: r,
      ultimaSync: Date.now(),
      error: "",
      estado: hayPendiente() ? "pendiente" : "sincronizado",
      pendientes: contarPendientes(),
    });
  } catch (e) {
    const err = e as ApiError;
    if (err.status === 401) {
      set({ usuario: null, estado: "error", error: err.message });
    } else {
      set({ estado: "error", error: err.message || "Sin conexión con GR Cup. Se reintentará." });
    }
    espera = Math.min(espera * 2, 30000);
  } finally {
    enviando = false;
    localStorage.setItem(LS, JSON.stringify(persistido));
  }
  if (hayPendiente() && state.usuario) programar(state.estado === "error" ? espera : 100);
}

// ---- actions of the GR Cup page ----

export function setUsuario(u: Usuario | null) {
  set({ usuario: u, error: u ? "" : state.error });
  if (u) programar(100);
}

export function conectar(c: Competicion, mesa: string) {
  dirty.todo = true;
  dirty.grupo = true;
  guardarDirty();
  set({ competicion: c, mesa: mesa.trim().slice(0, 120), activo: true, error: "", mesaEstado: null });
  programar(0);
}

export function pausar() {
  if (timer) clearTimeout(timer);
  set({ activo: false, estado: "desconectado" });
}

export function sincronizarTodo() {
  dirty.todo = true;
  dirty.grupo = true;
  guardarDirty();
  programar(0);
}

export function aplicarEstado(r: EstadoMesa) {
  set({ mesaEstado: r });
}

// Retry when the network comes back.
if (typeof window !== "undefined") {
  window.addEventListener("online", () => programar(0));
}
