/* Función de servidor (Vercel) — Edita usuarios ya creados.
   Cambia datos del perfil, el rol, el estado (activo/inactivo), el usuario
   de login y la CONTRASEÑA. Solo el Maestro puede usarla.
   Usa la clave secreta de Supabase (SUPABASE_SERVICE_ROLE_KEY), que vive
   solo en el servidor: desde el navegador la tabla `perfiles` es de solo
   lectura y las contraseñas no se pueden tocar. */
import { createClient } from '@supabase/supabase-js';

const ROLES = ['Vendedor', 'Administrador', 'Producción', 'Maestro'];
const BAN_LARGO = '876000h'; // ~100 años: el usuario inactivo no puede iniciar sesión

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { id, nombre, apellido, usuario, rol, activo, password } = req.body || {};
    if (!id) return res.status(400).json({ error: 'Falta el id del usuario' });
    if (rol != null && !ROLES.includes(rol)) return res.status(400).json({ error: 'Rol no válido' });
    if (password && String(password).length < 6) return res.status(400).json({ error: 'La contraseña tiene que tener al menos 6 caracteres' });

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Verificar que quien llama tenga sesión y sea Maestro
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ error: 'Sesión no válida' });
    const { data: perfilCaller } = await admin.from('perfiles').select('rol').eq('id', u.user.id).single();
    if (!perfilCaller || perfilCaller.rol !== 'Maestro') return res.status(403).json({ error: 'Solo el Maestro puede editar usuarios' });

    // Candados sobre uno mismo: si el Maestro se desactiva o se baja el rol, se queda afuera
    if (id === u.user.id) {
      if (activo === false) return res.status(400).json({ error: 'No podés desactivar tu propio usuario' });
      if (rol != null && rol !== 'Maestro') return res.status(400).json({ error: 'No podés cambiarte el rol a vos mismo' });
    }

    const { data: actual, error: ae } = await admin.from('perfiles').select('*').eq('id', id).single();
    if (ae || !actual) return res.status(404).json({ error: 'El usuario no existe' });

    /* ---- 1) Credenciales en Auth: contraseña, usuario de login y bloqueo ---- */
    const authPatch = {};
    if (password) authPatch.password = String(password);

    let usuarioNorm = actual.usuario;
    if (usuario != null && usuario !== actual.usuario) {
      usuarioNorm = String(usuario).toLowerCase().replace(/\s+/g, '-');
      if (!/^[a-z0-9._-]+$/.test(usuarioNorm)) {
        return res.status(400).json({ error: 'El usuario solo puede tener letras, números, puntos o guiones (sin espacios ni acentos)' });
      }
      // El Maestro entra con su email real: en ese caso no le tocamos el email de login
      const { data: authUser } = await admin.auth.admin.getUserById(id);
      const emailActual = (authUser && authUser.user && authUser.user.email) || '';
      if (emailActual.endsWith('@aura.local')) {
        authPatch.email = usuarioNorm + '@aura.local';
        authPatch.email_confirm = true;
      }
    }
    if (activo != null) authPatch.ban_duration = activo ? 'none' : BAN_LARGO;

    if (Object.keys(authPatch).length) {
      const { error: aue } = await admin.auth.admin.updateUserById(id, authPatch);
      if (aue) return res.status(400).json({ error: aue.message });
    }

    /* ---- 2) Datos del perfil ---- */
    const fila = {};
    if (nombre != null) fila.nombre = nombre;
    if (apellido != null) fila.apellido = apellido;
    if (usuario != null) fila.usuario = usuarioNorm;
    if (rol != null) fila.rol = rol;
    if (activo != null) fila.activo = !!activo;

    if (Object.keys(fila).length) {
      const { data: filas, error: pe } = await admin.from('perfiles').update(fila).eq('id', id).select();
      if (pe) return res.status(400).json({ error: pe.message });
      if (!filas || !filas.length) return res.status(500).json({ error: 'No se pudo actualizar el perfil' });
    }

    return res.status(200).json({ ok: true, usuario: usuarioNorm, passwordCambiada: !!password });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
