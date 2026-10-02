export function normalizePhone(phone: string) {
  return phone.replace(/\s+/g, '').trim();
}

export function phoneToAuthEmail(phone: string) {
  const normalized = normalizePhone(phone);

  return `${normalized}@members.mutqin.local`;
}