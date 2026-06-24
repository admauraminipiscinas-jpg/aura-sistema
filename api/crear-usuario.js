/* Función de servidor (Vercel) — Crea usuarios de login.
   Solo el Maestro puede usarla. Usa la clave secreta de Supabase
   (SUPABASE_SERVICE_ROLE_KEY), que vive solo en el servidor. */
import { createClient } from '@supabase/supabase-js';

export default async function handler(req, res) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'Método no permitido' });
  try {
    const { email, password, nombre, apellido, usuario, rol } = req.body || {};
    if (!email || !password || !rol) return res.status(400).json({ error: 'Faltan email, contraseña o rol' });
    if (!['Vendedor', 'Administrador', 'Producción', 'Maestro'].includes(rol)) return res.status(400).json({ error: 'Rol no válido' });

    const admin = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_SERVICE_ROLE_KEY);

    // Verificar que quien llama tenga sesión y sea Maestro
    const token = (req.headers.authorization || '').replace('Bearer ', '');
    const { data: u, error: ue } = await admin.auth.getUser(token);
    if (ue || !u || !u.user) return res.status(401).json({ error: 'Sesión no válida' });
    const { data: perfilCaller } = await admin.from('perfiles').select('rol').eq('id', u.user.id).single();
    if (!perfilCaller || perfilCaller.rol !== 'Maestro') return res.status(403).json({ error: 'Solo el Maestro puede crear usuarios' });

    // Crear el usuario de login (email + contraseña, ya confirmado)
    const { data, error } = await admin.auth.admin.createUser({ email, password, email_confirm: true });
    if (error) return res.status(400).json({ error: error.message });

    // Crear el perfil con su rol
    const { error: pe } = await admin.from('perfiles').insert({
      id: data.user.id, nombre: nombre || '', apellido: apellido || '',
      usuario: usuario || email, rol, activo: true
    });
    if (pe) return res.status(400).json({ error: pe.message });

    return res.status(200).json({ ok: true, id: data.user.id });
  } catch (e) {
    return res.status(500).json({ error: e.message });
  }
}
