// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: «Competiciones preparadas». The setup of each meet of the competition lives on the GR Cup server;
// the desk opens it from a list instead of loading a .openlifter file.

import { api } from "./api";
import rootReducer from "../reducers/rootReducer";
import { newDefaultEntry } from "../logic/entry";
import { Entry } from "../types/dataTypes";
import { GlobalState } from "../types/stateTypes";

export type MeetResumen = {
  mesa: string;
  nombre: string;
  fecha: string;
  atletas: number;
  vinculados: number;
  actualizado: string;
};

export type Horario = {
  publicado: boolean;
  version?: number;
  sesiones: number;
  asignadas: number;
  sinSesion: number;
  aviso?: string;
};

export type MeetCompleto = {
  mesa: string;
  meet: Record<string, unknown>;
  entradas: Array<Record<string, unknown>>;
  grupo?: { day: number; platform: number; flight: string; lift: "S" | "B" | "D" };
  horario: Horario;
};

export const listarMeets = (cid: string) =>
  api<{ meets: Array<MeetResumen> }>("GET", `/api/admin/competiciones/${cid}/openlifter/meets`).then((r) => r.meets);

export const descargarMeet = (cid: string, mesa: string) =>
  api<MeetCompleto>("GET", `/api/admin/competiciones/${cid}/openlifter/meet?mesa=${encodeURIComponent(mesa)}`);

// estadoDe builds the OpenLifter state of a meet opened from the server: OpenLifter's defaults, the meet setup,
// every entry (missing fields take OpenLifter's defaults) and the last lifting group of the desk.
export function estadoDe(m: MeetCompleto, language: GlobalState["language"]): GlobalState {
  // the root reducer called with no real action returns every default state (as «New Meet» does)
  const base = rootReducer({ language } as GlobalState, "OVERWRITE_STORE" as any);
  const entries: Array<Entry> = m.entradas.map((e) => ({ ...newDefaultEntry(Number(e.id)), ...e }) as Entry);
  const lookup: { [id: number]: number } = {};
  entries.forEach((e, i) => {
    lookup[e.id] = i;
  });
  return {
    ...base,
    language,
    meet: { ...base.meet, ...m.meet } as GlobalState["meet"],
    registration: { nextEntryId: entries.reduce((n, e) => Math.max(n, e.id + 1), 1), entries, lookup },
    lifting: m.grupo ? ({ ...base.lifting, ...m.grupo } as GlobalState["lifting"]) : base.lifting,
  };
}
