// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: builds OpenLifter registrations from the athletes confirmed on the GR Cup platform and, on an AEP 2 /
// AEP 3 desk, from the AEP roll of that level («padrón AEP», BIZ-210).

import { Entry, Flight, Sex } from "../types/dataTypes";
import { GlobalState } from "../types/stateTypes";

export type AtletaGR = {
  id: string;
  nombre: string;
  sexo: "M" | "F";
  fechaNacimiento?: string;
  categoria: string; // «-83», «+120»
  division: string;
  club?: string;
  licencia?: string;
  instagram?: string;
  flight?: string;
  plataforma?: number;
  pesoCorporal?: number;
  primeros: { sq?: number; bp?: number; dl?: number };
  rackSq?: number;
  rackBp?: string;
  prueba?: string; // «aep2», «aep3»
  // AEP roll rows: id is the roll row, atletaId the athlete linked with it (if any).
  padron?: boolean;
  atletaId?: string;
  entryId?: number;
  equipamiento?: "raw" | "equipado";
  anioNacimiento?: number;
  totalAnterior?: number;
};

const FLIGHTS = "ABCDEFGHIJKLMNOP";

// clave: name without accents, case or punctuation, words in any order.
const clave = (s: string) =>
  s
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim()
    .split(" ")
    .filter((w) => w && !["de", "del", "la", "las", "los", "y"].includes(w))
    .sort()
    .join(" ");

// «-83» → «83», «+120» → «120+» (OpenLifter's weight class format).
const clase = (c: string) => (c.startsWith("+") ? c.slice(1) + "+" : c.replace(/^-/, ""));

const intentos = (v: number | undefined): Array<number> => [v && v > 0 ? v : 0, 0, 0, 0, 0];

// notasPadron: the age and the AEP list facts of a roll row (the list has the birth year, not the date).
const notasPadron = (a: AtletaGR, anioMeet: number): Partial<Entry> => {
  const notas: Array<string> = [];
  if (a.anioNacimiento) notas.push(`Año de nacimiento: ${a.anioNacimiento}`);
  if (a.totalAnterior) notas.push(`Total anterior: ${a.totalAnterior} kg`);
  notas.push(`Padrón ${(a.prueba || "").toUpperCase()}`);
  const out: Partial<Entry> = { notes: notas.join(" · ") };
  if (a.anioNacimiento && anioMeet > 1900) out.age = anioMeet - a.anioNacimiento;
  return out;
};

// importables returns the athletes not yet on this desk (not linked, no entry with their licence or name) with
// the registration to create for each one.
export function importables(
  atletas: Array<AtletaGR>,
  s: GlobalState,
  vinculados: Set<string>,
): Array<{ atleta: AtletaGR; entrada: Partial<Entry> }> {
  const licencias = new Set(
    s.registration.entries.map((e) => (e.memberId || "").toUpperCase().replace(/[^A-Z0-9]/g, "")).filter((x) => x),
  );
  const nombres = new Set(s.registration.entries.map((e) => clave(e.name)).filter((x) => x));
  const ids = new Set(s.registration.entries.map((e) => e.id));
  const anioMeet = parseInt((s.meet.date || "").slice(0, 4), 10);
  const divisiones = new Map(s.meet.divisions.map((d) => [d.toLowerCase(), d]));
  const out: Array<{ atleta: AtletaGR; entrada: Partial<Entry> }> = [];
  for (const a of atletas) {
    const lic = (a.licencia || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (vinculados.has(a.atletaId || a.id) || (lic && licencias.has(lic)) || nombres.has(clave(a.nombre))) continue;
    if (a.entryId !== undefined && ids.has(a.entryId)) continue;
    nombres.add(clave(a.nombre)); // the athlete and its roll row come once
    const letra = (a.flight || "").trim().charAt(0).toUpperCase();
    const div = divisiones.get((a.division || "").toLowerCase());
    out.push({
      atleta: a,
      entrada: {
        name: a.nombre,
        sex: a.sexo as Sex,
        birthDate: a.fechaNacimiento || "",
        intendedWeightClassKg: clase(a.categoria || ""),
        divisions: div ? [div] : [],
        events: ["SBD"],
        equipment: a.equipamiento === "equipado" ? "Single-ply" : "Sleeves",
        team: a.club || "",
        memberId: a.licencia || "",
        instagram: a.instagram || "",
        ...(a.padron ? notasPadron(a, anioMeet) : {}),
        flight: (FLIGHTS.includes(letra) && letra ? letra : "A") as Flight,
        platform: a.plataforma && a.plataforma > 0 ? a.plataforma : 1,
        day: 1,
        bodyweightKg: a.pesoCorporal || 0,
        squatRackInfo: a.rackSq ? String(a.rackSq) : "",
        benchRackInfo: a.rackBp || "",
        squatKg: intentos(a.primeros.sq),
        benchKg: intentos(a.primeros.bp),
        deadliftKg: intentos(a.primeros.dl),
      },
    });
  }
  return out;
}
