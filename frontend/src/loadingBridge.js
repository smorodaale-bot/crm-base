let startImpl = () => () => {};

export function bindLoading(start) {
  startImpl = typeof start === 'function' ? start : () => () => {};
}

/** Called from fetch. Returns a stop function. */
export function trackRequest(opts) {
  return startImpl(opts);
}
