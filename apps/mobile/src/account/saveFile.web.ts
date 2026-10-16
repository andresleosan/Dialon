/**
 * Web: descarga como adjunto con el nombre fijo generado por el cliente. El enlace temporal (`blob:`) se libera poco
 * después del clic, o antes con la función devuelta (al desmontar o cerrar sesión). Nunca se abre ni se incrusta.
 */
export function saveFile(bytes: Uint8Array, type: string, filename: string): (() => void) | undefined {
  const url = URL.createObjectURL(new Blob([bytes.slice()], { type }));
  let revoked = false;
  const revoke = () => {
    if (revoked) return;
    revoked = true;
    URL.revokeObjectURL(url);
  };
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.rel = "noopener";
  document.body.append(link);
  link.click();
  link.remove();
  // ponytail: margen para que el navegador empiece la descarga; la función devuelta lo libera antes si hace falta.
  setTimeout(revoke, 1000);
  return revoke;
}
