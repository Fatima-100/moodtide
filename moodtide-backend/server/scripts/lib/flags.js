// Command-line flags, the same style in every importer.
//   const f = getFlags();   f.dryRun   f.has('fresh')   f.opt('only', '')   f.int('limit', 300, 1, 5000)
export function getFlags(argv = process.argv.slice(2)) {
  const has = (n) => argv.includes(`--${n}`);
  const opt = (n, d) => {
    const i = argv.indexOf(`--${n}`);
    return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : d;
  };
  const int = (n, d, lo = -Infinity, hi = Infinity) => {
    const v = parseInt(opt(n, String(d)), 10);
    return Math.min(hi, Math.max(lo, Number.isFinite(v) ? v : d));
  };
  return { argv, has, opt, int, dryRun: has('dry-run'), fresh: has('fresh') };
}
