// Length class (task A15): under 90 seconds is short, 90 seconds to 8 minutes is standard, over 8 minutes is long.
export function lengthClass(sec) {
  const s = Number(sec) || 0;
  return s < 90 ? 'short' : s <= 480 ? 'standard' : 'long';
}
