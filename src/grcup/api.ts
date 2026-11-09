// vim: set ts=2 sts=2 sw=2 et:
//
// GR Cup fork: client of the GR Cup platform API, served on the same origin as this app (/api → gateway), so the
// refresh token lives in the platform's httpOnly cookie and the access token only in memory.

export type Usuario = {
  id: string;
  email: string;
  nombre: string;
  root: boolean;
  competiciones: Array<{ competitionId: string; permisos: Array<string> }>;
};

export type Competicion = { id: string; slug: string; nombre: string };

export class ApiError extends Error {
  status: number;
  code: string;
  constructor(status: number, message: string, code = "") {
    super(message);
    this.status = status;
    this.code = code;
  }
}

let accessToken = "";
let expiresAt = 0;
let refreshing: Promise<boolean> | null = null;

type Sesion = { accessToken: string; expiresAt: string; usuario: Usuario };

function guardar(s: Sesion): Usuario {
  accessToken = s.accessToken;
  expiresAt = Date.parse(s.expiresAt) || Date.now() + 10 * 60 * 1000;
  return s.usuario;
}

async function leerError(res: Response): Promise<ApiError> {
  let msg = `Error ${res.status}`;
  let code = "";
  try {
    const p = await res.json();
    msg = p.detail || p.title || msg;
    code = p.code || "";
  } catch (e) {
    // not JSON (proxy error page)
  }
  if (res.status === 502 || res.status === 503 || res.status === 504)
    msg = "La plataforma GR Cup no responde. Se reintentará.";
  return new ApiError(res.status, msg, code);
}

export async function login(email: string, password: string): Promise<Usuario> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password, cliente: "web" }),
  });
  if (!res.ok) throw await leerError(res);
  return guardar(await res.json());
}

// renovar rotates the refresh cookie and returns the user, or null when there is no valid session.
export async function renovar(): Promise<Usuario | null> {
  const res = await fetch("/api/auth/refresh", { method: "POST", credentials: "same-origin" });
  if (!res.ok) {
    accessToken = "";
    return null;
  }
  return guardar(await res.json());
}

export async function logout(): Promise<void> {
  try {
    await fetch("/api/auth/logout", { method: "POST", credentials: "same-origin" });
  } finally {
    accessToken = "";
    expiresAt = 0;
  }
}

async function asegurarToken(): Promise<boolean> {
  if (accessToken && Date.now() < expiresAt - 30 * 1000) return true;
  if (!refreshing) {
    refreshing = renovar()
      .then((u) => u !== null)
      .catch(() => false)
      .finally(() => {
        refreshing = null;
      });
  }
  return refreshing;
}

export async function api<T>(method: string, path: string, body?: unknown): Promise<T> {
  for (let intento = 0; intento < 2; intento++) {
    if (!(await asegurarToken()))
      throw new ApiError(401, "La sesión de GR Cup ha caducado: vuelve a iniciar sesión.", "SESION");
    const res = await fetch(path, {
      method,
      credentials: "same-origin",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    if (res.status === 401 && intento === 0) {
      accessToken = ""; // expired or revoked: refresh once and retry
      continue;
    }
    if (!res.ok) throw await leerError(res);
    if (res.status === 204) return undefined as unknown as T;
    return (await res.json()) as T;
  }
  throw new ApiError(401, "La sesión de GR Cup ha caducado: vuelve a iniciar sesión.", "SESION");
}

export const competiciones = () => api<Array<Competicion>>("GET", "/api/admin/competiciones");
