export const isOwner = (id: number | undefined): boolean => {
  if (id === undefined) return false;
  const owner = process.env.TELEGRAM_OWNER_ID?.trim();
  return Boolean(owner && String(id) === owner);
};
