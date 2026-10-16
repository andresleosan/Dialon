import { optionalString } from "./sarin";

// Propietario: SOLO con las cuatro condiciones a la vez, sobre claims ya verificados criptográficamente. Nada que envíe
// el cliente (cabeceras, cuerpo, consulta) participa. `OWNER_FIREBASE_UID` vacío = nadie es propietario.

export interface VerifiedIdentity {
  readonly uid: string;
  readonly email?: string;
  readonly emailVerified?: boolean;
}

export function isOwner(identity: VerifiedIdentity, env: object): boolean {
  const ownerUid = optionalString(env, "OWNER_FIREBASE_UID")?.trim() ?? "";
  const ownerEmail = optionalString(env, "OWNER_EMAIL")?.trim().toLowerCase() ?? "";
  if (ownerUid === "" || ownerEmail === "") return false;
  return identity.emailVerified === true && identity.uid === ownerUid && identity.email?.toLowerCase() === ownerEmail;
}
