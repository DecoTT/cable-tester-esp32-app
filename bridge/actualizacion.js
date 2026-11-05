// actualizacion.js — ¿Hay una version mas nueva en GitHub?
//
// POR QUE
//
// La app vive en PCs de planta que nadie administra. Hasta ahora, enterarse de
// que habia un arreglo dependia de que alguien mandara un correo — y el arreglo
// de las IPs tardo semanas en llegar a Guadalajara por eso mismo.
//
// Esto solo AVISA y, si se puede, actualiza cuando alguien lo pide. No se
// actualiza solo: cambiar el software de un banco de pruebas a media
// produccion, sin que nadie lo sepa, es peor que ir desactualizado.
//
// COMO SE SABE QUE VERSION HAY INSTALADA
//
//   · Clonado con git -> el SHA de HEAD. Exacto, y permite `git pull`.
//   · Descargado en ZIP -> no hay .git y NO se puede saber. Se dice cual es la
//     ultima de GitHub y con que fecha, y que lo compare quien mire.
//
// Nunca bloquea el arranque ni una prueba: si no hay internet, no hay aviso.

import { execFile } from "node:child_process";
import { promisify } from "node:util";
import path from "node:path";
import fs from "node:fs";
import { fileURLToPath } from "node:url";

const ejecutar = promisify(execFile);
const RAIZ = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const REPO = "DecoTT/cable-tester-esp32-app";
const RAMA = "main";

// Se consulta como mucho cada media hora. GitHub limita a 60 peticiones por
// hora sin credenciales, y una estacion que se reinicia a menudo las gastaria.
const CADA_MS = 30 * 60 * 1000;
let cache = { cuando: 0, dato: null };

async function git(...args) {
  const { stdout } = await ejecutar("git", args, { cwd: RAIZ, timeout: 10000 });
  return stdout.trim();
}

/** Que hay instalado aqui. Nunca lanza: si algo falla, lo dice en el resultado. */
export async function versionLocal() {
  const esGit = fs.existsSync(path.join(RAIZ, ".git"));
  const base = { es_git: esGit, sha: null, fecha: null, rama: null, limpio: null };
  if (!esGit) return base;
  try {
    const [sha, fecha, rama, estado] = await Promise.all([
      git("rev-parse", "HEAD"),
      git("log", "-1", "--format=%cI"),
      git("rev-parse", "--abbrev-ref", "HEAD"),
      git("status", "--porcelain"),
    ]);
    // `limpio` importa: con cambios locales sin guardar, `git pull --ff-only`
    // falla, y es mejor avisar antes que dejar la actualizacion a medias.
    return { es_git: true, sha, fecha, rama, limpio: estado.length === 0 };
  } catch {
    return base;
  }
}

/** Lo ultimo publicado en GitHub, con lo que ha cambiado desde lo instalado. */
export async function comprobar({ forzar = false } = {}) {
  if (!forzar && cache.dato && Date.now() - cache.cuando < CADA_MS) return cache.dato;

  const local = await versionLocal();
  const salida = { ok: false, local, hay: false, remoto: null, cambios: [], error: null };

  try {
    const pedir = async (url) => {
      const r = await fetch(url, {
        headers: { "User-Agent": "cabletester32", Accept: "application/vnd.github+json" },
        signal: AbortSignal.timeout(8000),
      });
      if (!r.ok) throw new Error(`GitHub respondió ${r.status}`);
      return r.json();
    };

    const ultimo = await pedir(`https://api.github.com/repos/${REPO}/commits/${RAMA}`);
    salida.remoto = {
      sha: ultimo.sha,
      fecha: ultimo.commit?.committer?.date ?? null,
      titulo: (ultimo.commit?.message ?? "").split("\n")[0],
    };
    salida.ok = true;

    if (local.sha && local.sha !== ultimo.sha) {
      salida.hay = true;
      // Que ha cambiado, en titulares. Si la comparacion falla —por ejemplo
      // porque la copia local es muy vieja y GitHub no la conoce— se sigue
      // avisando igual: saber QUE cambio es util, pero saber que HAY algo
      // nuevo es lo importante.
      try {
        const cmp = await pedir(
          `https://api.github.com/repos/${REPO}/compare/${local.sha}...${ultimo.sha}`);
        salida.cambios = (cmp.commits ?? []).reverse().map((c) => ({
          sha: c.sha.slice(0, 7),
          fecha: c.commit?.committer?.date ?? null,
          titulo: (c.commit?.message ?? "").split("\n")[0],
        }));
        salida.detras = cmp.ahead_by ?? salida.cambios.length;
      } catch { /* sin detalle, pero el aviso vale */ }
    } else if (!local.sha) {
      // Copia en ZIP: no se puede comparar. Se dice lo que hay publicado.
      salida.hay = null;
    }
  } catch (e) {
    salida.error = String(e?.message ?? e);
  }

  cache = { cuando: Date.now(), dato: salida };
  return salida;
}

export function registrarActualizacionRoutes(app) {
  app.get("/api/version", async (_req, res) => res.json(await versionLocal()));

  app.get("/api/actualizacion", async (req, res) =>
    res.json(await comprobar({ forzar: req.query.forzar === "1" })));

  /**
   * Lanzar la actualizacion.
   *
   * No se actualiza desde dentro del propio proceso: habria que pararse a si
   * mismo a mitad. Se lanza `actualizar.bat` en una ventana aparte, y es ese
   * quien cierra el bridge, actualiza y lo vuelve a abrir.
   */
  app.post("/api/actualizar", async (_req, res) => {
    const bat = path.join(RAIZ, "actualizar.bat");
    if (!fs.existsSync(bat)) {
      return res.status(404).json({ ok: false, error: "no encuentro actualizar.bat" });
    }
    const local = await versionLocal();
    if (!local.es_git) {
      return res.status(422).json({
        ok: false,
        error: "Esta copia no se descargó con git, así que no se puede actualizar sola. " +
               "Descarga el proyecto de nuevo desde GitHub.",
      });
    }
    if (local.limpio === false) {
      return res.status(422).json({
        ok: false,
        error: "Hay cambios locales sin guardar en esta carpeta. " +
               "Actualizar los perdería, así que no se hace solo.",
      });
    }
    try {
      const { spawn } = await import("node:child_process");
      spawn("cmd.exe", ["/c", "start", "", bat], { cwd: RAIZ, detached: true, stdio: "ignore" })
        .unref();
      res.json({ ok: true, mensaje: "Actualizando en otra ventana. La app se cerrará y volverá sola." });
    } catch (e) {
      res.status(500).json({ ok: false, error: String(e?.message ?? e) });
    }
  });
}
